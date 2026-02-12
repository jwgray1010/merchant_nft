import { Router } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import { getSubscriptionForBrand } from "../billing/subscriptions";
import {
  locationCreateSchema,
  locationUpdateSchema,
} from "../schemas/locationSchema";
import { tenantSettingsUpsertSchema } from "../schemas/tenantSchema";
import { brandVoiceSampleCreateSchema } from "../schemas/voiceSchema";
import {
  addLocation,
  deleteLocation,
  listLocations,
  updateLocation,
} from "../services/locationStore";
import { getOwnerTenantSettings, upsertOwnerTenantSettings } from "../services/tenantStore";
import {
  addBrandVoiceSample,
  getBrandVoiceProfile,
  listBrandVoiceSamples,
} from "../services/voiceStore";
import {
  canTrainBrandVoiceNow,
  trainBrandVoiceProfile,
} from "../services/voiceTrainingService";
import { getAdapter } from "../storage/getAdapter";
import { extractAuthToken, resolveAuthUser } from "../supabase/verifyAuth";

const router = Router();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)} · MainStreetAI Admin</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 20px; }
      .row { display:flex; gap:10px; flex-wrap: wrap; align-items:center; }
      .card { background:#fff; border:1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
      .button { border:1px solid #2563eb; background:#2563eb; color:#fff; border-radius:8px; padding:8px 12px; text-decoration:none; display:inline-block; cursor:pointer; }
      .button.secondary { background:#fff; color:#0f172a; border-color:#cbd5e1; }
      input, select { border:1px solid #cbd5e1; border-radius:8px; padding:8px; }
      table { width:100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #e2e8f0; padding:8px; text-align:left; }
      .muted { color:#64748b; font-size:13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="row" style="margin-bottom:12px;">
        <a class="button secondary" href="/admin">Admin Home</a>
        <a class="button secondary" href="/admin/billing">Billing</a>
        <a class="button secondary" href="/admin/team">Team</a>
        <a class="button secondary" href="/admin/voice">Voice</a>
        <a class="button secondary" href="/admin/locations">Locations</a>
        <a class="button secondary" href="/admin/tenant/settings">Tenant</a>
        <a class="button secondary" href="/admin/welcome">Welcome</a>
      </div>
      ${body}
    </div>
  </body>
</html>`;
}

router.use(async (req, res, next) => {
  const token = extractAuthToken(req);
  if (!token) {
    return res.redirect("/admin/login");
  }
  const user = await resolveAuthUser(token);
  if (!user) {
    return res.redirect("/admin/login");
  }
  req.user = user;
  return next();
});

router.get("/welcome", (_req, res) => {
  const html = render(
    "Welcome",
    `
      <div class="card">
        <h1>Welcome to MainStreetAI</h1>
        <p>Start by onboarding your business profile and connecting billing/integrations.</p>
        <div class="row">
          <a class="button" href="/onboarding">Start Onboarding</a>
          <a class="button secondary" href="/admin">Open Admin</a>
        </div>
      </div>
    `,
  );
  return res.type("html").send(html);
});

router.get("/billing", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const selectedBrandId =
      typeof req.query.brandId === "string" && req.query.brandId.trim() !== ""
        ? req.query.brandId.trim()
        : brands[0]?.brandId ?? "";

    let billingHtml = `<p class="muted">Create a brand first to manage billing.</p>`;
    if (selectedBrandId) {
      const access = await resolveBrandAccess(actorId, selectedBrandId);
      if (access) {
        const subscription = await getSubscriptionForBrand(access.ownerId, access.brandId);
        billingHtml = `
          <p><strong>Current plan:</strong> ${escapeHtml(subscription.plan)}</p>
          <p><strong>Status:</strong> ${escapeHtml(subscription.status)}</p>
          <p class="muted">Role: ${escapeHtml(access.role)}</p>
          <div class="row">
            <button class="button" data-price="${escapeHtml(
              process.env.STRIPE_PRICE_STARTER ?? "",
            )}" data-brand="${escapeHtml(access.brandId)}">Upgrade to Starter</button>
            <button class="button" data-price="${escapeHtml(
              process.env.STRIPE_PRICE_PRO ?? "",
            )}" data-brand="${escapeHtml(access.brandId)}">Upgrade to Pro</button>
            <button class="button secondary" data-cancel-brand="${escapeHtml(access.brandId)}">Cancel at period end</button>
          </div>
          <p class="muted" style="margin-top:8px;">Billing changes are owner-only.</p>
        `;
      }
    }

    const options = brands
      .map((brand) => {
        const selected = brand.brandId === selectedBrandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");
    const html = render(
      "Billing",
      `
      <div class="card">
        <h1>Billing</h1>
        <form method="GET" action="/admin/billing" class="row">
          <label><strong>Brand</strong></label>
          <select name="brandId" onchange="this.form.submit()">${options}</select>
        </form>
      </div>
      <div class="card">${billingHtml}</div>
      <script>
        async function postJson(url, body) {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(json.error || "Request failed");
          }
          return json;
        }

        document.querySelectorAll("button[data-price]").forEach((button) => {
          button.addEventListener("click", async () => {
            const priceId = button.getAttribute("data-price") || "";
            const brandId = button.getAttribute("data-brand") || "";
            if (!priceId) {
              alert("Missing Stripe price id configuration.");
              return;
            }
            try {
              const payload = await postJson("/api/billing/create-checkout-session", { brandId, priceId });
              if (payload.url) {
                window.location.href = payload.url;
              }
            } catch (error) {
              alert(String(error.message || error));
            }
          });
        });

        document.querySelectorAll("button[data-cancel-brand]").forEach((button) => {
          button.addEventListener("click", async () => {
            const brandId = button.getAttribute("data-cancel-brand") || "";
            if (!confirm("Cancel subscription at period end?")) return;
            try {
              await postJson("/api/billing/cancel-subscription", { brandId });
              window.location.reload();
            } catch (error) {
              alert(String(error.message || error));
            }
          });
        });
      </script>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/team", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const selectedBrandId =
      typeof req.query.brandId === "string" && req.query.brandId.trim() !== ""
        ? req.query.brandId.trim()
        : brands[0]?.brandId ?? "";
    const brandOptions = brands
      .map((brand) => {
        const selected = brand.brandId === selectedBrandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");

    const html = render(
      "Team",
      `
      <div class="card">
        <h1>Team Members</h1>
        <form method="GET" action="/admin/team" class="row">
          <label><strong>Brand</strong></label>
          <select id="brandId" name="brandId" onchange="this.form.submit()">${brandOptions}</select>
        </form>
      </div>
      <div class="card">
        <h2>Invite</h2>
        <form id="invite-form" class="row">
          <input type="email" name="email" placeholder="teammate@email.com" required />
          <select name="role"><option value="member">member</option><option value="admin">admin</option></select>
          <button type="submit" class="button">Invite</button>
        </form>
        <p class="muted">Owner handles billing. Admin can manage autopilot/settings. Member is content+schedule only.</p>
      </div>
      <div class="card">
        <h2>Current team</h2>
        <table id="team-table">
          <thead><tr><th>Email/User</th><th>Role</th><th>Created</th><th></th></tr></thead>
          <tbody><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
        </table>
      </div>
      <script>
        const brandId = document.getElementById("brandId")?.value || "";
        const tbody = document.querySelector("#team-table tbody");
        const inviteForm = document.getElementById("invite-form");

        async function fetchTeam() {
          const response = await fetch("/api/team?brandId=" + encodeURIComponent(brandId));
          const json = await response.json().catch(() => []);
          if (!response.ok) {
            tbody.innerHTML = '<tr><td colspan="4" class="muted">' + (json.error || "Failed to load team") + '</td></tr>';
            return;
          }
          if (!Array.isArray(json) || json.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="muted">No team members yet.</td></tr>';
            return;
          }
          tbody.innerHTML = json.map((member) => {
            const email = member.email || member.userId || "";
            const removable = member.role !== "owner";
            const action = removable
              ? '<button class="button secondary" data-remove="' + member.id + '">Remove</button>'
              : '';
            return '<tr><td>' + email + '</td><td>' + member.role + '</td><td>' + (member.createdAt || "") + '</td><td>' + action + '</td></tr>';
          }).join("");
          tbody.querySelectorAll("button[data-remove]").forEach((button) => {
            button.addEventListener("click", async () => {
              const id = button.getAttribute("data-remove");
              if (!id) return;
              if (!confirm("Remove this team member?")) return;
              const response = await fetch("/api/team/" + encodeURIComponent(id) + "?brandId=" + encodeURIComponent(brandId), {
                method: "DELETE"
              });
              if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                alert(payload.error || "Failed to remove member");
              }
              await fetchTeam();
            });
          });
        }

        inviteForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const fd = new FormData(inviteForm);
          const payload = {
            email: String(fd.get("email") || ""),
            role: String(fd.get("role") || "member"),
          };
          const response = await fetch("/api/team/invite?brandId=" + encodeURIComponent(brandId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            alert(body.error || "Failed to invite member");
            return;
          }
          inviteForm.reset();
          await fetchTeam();
        });

        fetchTeam();
      </script>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.get("/voice", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const selectedBrandId =
      typeof req.query.brandId === "string" && req.query.brandId.trim() !== ""
        ? req.query.brandId.trim()
        : brands[0]?.brandId ?? "";
    const options = brands
      .map((brand) => {
        const selected = brand.brandId === selectedBrandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");
    if (!selectedBrandId) {
      return res
        .type("html")
        .send(render("Voice", '<div class="card"><h1>Voice</h1><p>Create a brand first.</p></div>'));
    }

    const access = await resolveBrandAccess(actorId, selectedBrandId);
    if (!access) {
      return res.status(404).type("html").send(render("Voice", "<div class='card'><p>Brand not found.</p></div>"));
    }
    const [samples, profile] = await Promise.all([
      listBrandVoiceSamples(access.ownerId, access.brandId, 50),
      getBrandVoiceProfile(access.ownerId, access.brandId),
    ]);
    const notice =
      typeof req.query.notice === "string" && req.query.notice.trim() !== ""
        ? `<p class="muted">${escapeHtml(req.query.notice)}</p>`
        : "";
    const html = render(
      "Voice",
      `
      <div class="card">
        <h1>Brand Voice Training</h1>
        <form method="GET" action="/admin/voice" class="row">
          <label><strong>Brand</strong></label>
          <select name="brandId" onchange="this.form.submit()">${options}</select>
        </form>
        ${notice}
      </div>
      <div class="card">
        <h2>Add voice sample</h2>
        <form method="POST" action="/admin/voice/samples" class="row" style="align-items:flex-start;">
          <input type="hidden" name="brandId" value="${escapeHtml(access.brandId)}" />
          <select name="source">
            <option value="caption">caption</option>
            <option value="sms">sms</option>
            <option value="email">email</option>
            <option value="manual">manual</option>
          </select>
          <input name="content" placeholder="Paste a real caption or message..." style="min-width:320px;" required />
          <button class="button" type="submit">Add sample</button>
        </form>
        <p class="muted">Capture real customer-facing text. Up to 200 samples are retained automatically.</p>
      </div>
      <div class="card">
        <h2>Train profile</h2>
        <form method="POST" action="/admin/voice/train">
          <input type="hidden" name="brandId" value="${escapeHtml(access.brandId)}" />
          <button class="button" type="submit">Run training</button>
        </form>
        <p class="muted">Uses the latest 50 samples and updates style summary/rules for all future AI outputs.</p>
      </div>
      <div class="card">
        <h2>Current profile</h2>
        ${
          profile
            ? `<p><strong>Summary:</strong> ${escapeHtml(profile.styleSummary ?? "—")}</p>
               <p><strong>Emoji style:</strong> ${escapeHtml(profile.emojiStyle ?? "—")}</p>
               <p><strong>Energy:</strong> ${escapeHtml(profile.energyLevel ?? "—")}</p>
               <p><strong>Phrases to repeat:</strong> ${escapeHtml(profile.phrasesToRepeat.join(" | ") || "—")}</p>
               <p><strong>Phrases to avoid:</strong> ${escapeHtml(profile.doNotUse.join(" | ") || "—")}</p>`
            : "<p class='muted'>No trained profile yet.</p>"
        }
      </div>
      <div class="card">
        <h2>Recent samples</h2>
        <table>
          <thead><tr><th>Created</th><th>Source</th><th>Content</th></tr></thead>
          <tbody>
            ${
              samples.length > 0
                ? samples
                    .map(
                      (sample) => `<tr>
                        <td>${escapeHtml(sample.createdAt)}</td>
                        <td>${escapeHtml(sample.source)}</td>
                        <td>${escapeHtml(sample.content)}</td>
                      </tr>`,
                    )
                    .join("")
                : '<tr><td colspan="3" class="muted">No samples yet.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/voice/samples", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    if (!brandId) {
      return res.redirect("/admin/voice?notice=Missing%20brandId");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access || (access.role !== "owner" && access.role !== "admin")) {
      return res.redirect(`/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=Permission%20denied`);
    }
    const parsed = brandVoiceSampleCreateSchema.safeParse({
      source: req.body?.source,
      content: req.body?.content,
    });
    if (!parsed.success) {
      return res.redirect(
        `/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=Invalid%20sample%20payload`,
      );
    }
    await addBrandVoiceSample(access.ownerId, access.brandId, parsed.data);
    return res.redirect(
      `/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=Voice%20sample%20saved`,
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/voice/train", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    if (!brandId) {
      return res.redirect("/admin/voice?notice=Missing%20brandId");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access || (access.role !== "owner" && access.role !== "admin")) {
      return res.redirect(`/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=Permission%20denied`);
    }
    const rateLimit = canTrainBrandVoiceNow(access.ownerId, access.brandId);
    if (!rateLimit.ok) {
      return res.redirect(
        `/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=Try%20again%20in%20a%20few%20minutes`,
      );
    }
    await trainBrandVoiceProfile({
      userId: access.ownerId,
      brandId: access.brandId,
    });
    return res.redirect(
      `/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=Voice%20profile%20trained`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice training failed";
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    if (brandId) {
      return res.redirect(
        `/admin/voice?brandId=${encodeURIComponent(brandId)}&notice=${encodeURIComponent(message)}`,
      );
    }
    return next(error);
  }
});

router.get("/locations", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const selectedBrandId =
      typeof req.query.brandId === "string" && req.query.brandId.trim() !== ""
        ? req.query.brandId.trim()
        : brands[0]?.brandId ?? "";
    const options = brands
      .map((brand) => {
        const selected = brand.brandId === selectedBrandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");
    if (!selectedBrandId) {
      return res
        .type("html")
        .send(render("Locations", '<div class="card"><h1>Locations</h1><p>Create a brand first.</p></div>'));
    }
    const access = await resolveBrandAccess(actorId, selectedBrandId);
    if (!access) {
      return res
        .status(404)
        .type("html")
        .send(render("Locations", "<div class='card'><p>Brand not found.</p></div>"));
    }
    const locations = await listLocations(access.ownerId, access.brandId);
    const notice =
      typeof req.query.notice === "string" && req.query.notice.trim() !== ""
        ? `<p class="muted">${escapeHtml(req.query.notice)}</p>`
        : "";
    const html = render(
      "Locations",
      `
      <div class="card">
        <h1>Multi-location Manager</h1>
        <form method="GET" action="/admin/locations" class="row">
          <label><strong>Brand</strong></label>
          <select name="brandId" onchange="this.form.submit()">${options}</select>
        </form>
        ${notice}
      </div>
      <div class="card">
        <h2>Add location</h2>
        <form method="POST" action="/admin/locations" class="row" style="align-items:flex-end;">
          <input type="hidden" name="brandId" value="${escapeHtml(access.brandId)}" />
          <label>Name<br/><input name="name" required /></label>
          <label>Address<br/><input name="address" /></label>
          <label>Timezone<br/><input name="timezone" value="America/Chicago" /></label>
          <label>GBP location name<br/><input name="googleLocationName" placeholder="locations/123..." /></label>
          <label>Buffer profile id<br/><input name="bufferProfileId" /></label>
          <button class="button" type="submit">Add</button>
        </form>
      </div>
      <div class="card">
        <h2>Existing locations</h2>
        <table>
          <thead><tr><th>Name</th><th>Address</th><th>Timezone</th><th>GBP</th><th>Buffer</th><th></th></tr></thead>
          <tbody>
            ${
              locations.length > 0
                ? locations
                    .map(
                      (location) => `
                      <tr>
                        <td>${escapeHtml(location.name)}</td>
                        <td>${escapeHtml(location.address ?? "")}</td>
                        <td>${escapeHtml(location.timezone)}</td>
                        <td>${escapeHtml(location.googleLocationName ?? "")}</td>
                        <td>${escapeHtml(location.bufferProfileId ?? "")}</td>
                        <td>
                          <form method="POST" action="/admin/locations/${escapeHtml(
                            location.id,
                          )}" class="row">
                            <input type="hidden" name="brandId" value="${escapeHtml(access.brandId)}" />
                            <input type="hidden" name="name" value="${escapeHtml(location.name)}" />
                            <input type="hidden" name="address" value="${escapeHtml(location.address ?? "")}" />
                            <input type="hidden" name="timezone" value="${escapeHtml(location.timezone)}" />
                            <input type="hidden" name="googleLocationName" value="${escapeHtml(
                              location.googleLocationName ?? "",
                            )}" />
                            <input type="hidden" name="bufferProfileId" value="${escapeHtml(
                              location.bufferProfileId ?? "",
                            )}" />
                            <button class="button secondary" type="submit">Update</button>
                          </form>
                          <form method="POST" action="/admin/locations/${escapeHtml(
                            location.id,
                          )}/delete" style="margin-top:6px;">
                            <input type="hidden" name="brandId" value="${escapeHtml(access.brandId)}" />
                            <button class="button secondary" type="submit">Delete</button>
                          </form>
                        </td>
                      </tr>`,
                    )
                    .join("")
                : '<tr><td colspan="6" class="muted">No locations yet.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/locations", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    if (!brandId) {
      return res.redirect("/admin/locations?notice=Missing%20brandId");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access || (access.role !== "owner" && access.role !== "admin")) {
      return res.redirect(`/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Permission%20denied`);
    }
    const optionalString = (value: unknown): string | undefined => {
      if (typeof value !== "string") {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    };
    const parsed = locationCreateSchema.safeParse({
      name: req.body?.name,
      address: optionalString(req.body?.address),
      timezone: optionalString(req.body?.timezone),
      googleLocationName: optionalString(req.body?.googleLocationName),
      bufferProfileId: optionalString(req.body?.bufferProfileId),
    });
    if (!parsed.success) {
      return res.redirect(
        `/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Invalid%20location%20payload`,
      );
    }
    await addLocation(access.ownerId, access.brandId, parsed.data);
    return res.redirect(
      `/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Location%20added`,
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/locations/:id", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    const locationId = req.params.id?.trim();
    if (!brandId || !locationId) {
      return res.redirect("/admin/locations?notice=Missing%20params");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access || (access.role !== "owner" && access.role !== "admin")) {
      return res.redirect(`/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Permission%20denied`);
    }
    const optionalString = (value: unknown): string | undefined => {
      if (typeof value !== "string") {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    };
    const rawUpdates: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim() !== "") {
      rawUpdates.name = req.body.name.trim();
    }
    const address = optionalString(req.body?.address);
    if (address !== undefined) {
      rawUpdates.address = address;
    }
    const timezone = optionalString(req.body?.timezone);
    if (timezone !== undefined) {
      rawUpdates.timezone = timezone;
    }
    const googleLocationName = optionalString(req.body?.googleLocationName);
    if (googleLocationName !== undefined) {
      rawUpdates.googleLocationName = googleLocationName;
    }
    const bufferProfileId = optionalString(req.body?.bufferProfileId);
    if (bufferProfileId !== undefined) {
      rawUpdates.bufferProfileId = bufferProfileId;
    }
    const parsed = locationUpdateSchema.safeParse(rawUpdates);
    if (!parsed.success) {
      return res.redirect(
        `/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Invalid%20location%20update`,
      );
    }
    await updateLocation(access.ownerId, access.brandId, locationId, parsed.data);
    return res.redirect(
      `/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Location%20updated`,
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/locations/:id/delete", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    const locationId = req.params.id?.trim();
    if (!brandId || !locationId) {
      return res.redirect("/admin/locations?notice=Missing%20params");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access || (access.role !== "owner" && access.role !== "admin")) {
      return res.redirect(`/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Permission%20denied`);
    }
    await deleteLocation(access.ownerId, access.brandId, locationId);
    return res.redirect(
      `/admin/locations?brandId=${encodeURIComponent(brandId)}&notice=Location%20deleted`,
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/tenant/settings", async (req, res, next) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      return res.redirect("/admin/login");
    }
    const settings = await getOwnerTenantSettings(ownerId);
    const notice =
      typeof req.query.notice === "string" && req.query.notice.trim() !== ""
        ? `<p class="muted">${escapeHtml(req.query.notice)}</p>`
        : "";
    const html = render(
      "Tenant Settings",
      `
      <div class="card">
        <h1>Tenant Branding (White-label)</h1>
        ${notice}
        <form method="POST" action="/admin/tenant/settings">
          <div class="row" style="align-items:flex-end;">
            <label>Name<br/><input name="name" value="${escapeHtml(settings?.name ?? "")}" /></label>
            <label>Domain<br/><input name="domain" value="${escapeHtml(settings?.domain ?? "")}" placeholder="app.youragency.com" /></label>
            <label>Support Email<br/><input name="supportEmail" value="${escapeHtml(settings?.supportEmail ?? "")}" /></label>
          </div>
          <div class="row" style="align-items:flex-end;margin-top:10px;">
            <label>App Name<br/><input name="appName" value="${escapeHtml(settings?.appName ?? "MainStreetAI")}" /></label>
            <label>Tagline<br/><input name="tagline" value="${escapeHtml(settings?.tagline ?? "")}" /></label>
            <label>Primary Color<br/><input name="primaryColor" value="${escapeHtml(settings?.primaryColor ?? "#2563eb")}" /></label>
          </div>
          <div class="row" style="align-items:flex-end;margin-top:10px;">
            <label>Logo URL<br/><input name="logoUrl" value="${escapeHtml(settings?.logoUrl ?? "")}" /></label>
            <label><input type="checkbox" name="hideMainstreetaiBranding" ${
              settings?.hideMainstreetaiBranding ? "checked" : ""
            } /> Hide MainStreetAI branding</label>
          </div>
          <div style="margin-top:12px;">
            <button class="button" type="submit">Save tenant settings</button>
          </div>
        </form>
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/tenant/settings", async (req, res, next) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      return res.redirect("/admin/login");
    }
    const payload = {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      domain: typeof req.body?.domain === "string" ? req.body.domain : undefined,
      logoUrl:
        typeof req.body?.logoUrl === "string" && req.body.logoUrl.trim() !== ""
          ? req.body.logoUrl
          : undefined,
      primaryColor: typeof req.body?.primaryColor === "string" ? req.body.primaryColor : undefined,
      supportEmail:
        typeof req.body?.supportEmail === "string" && req.body.supportEmail.trim() !== ""
          ? req.body.supportEmail
          : undefined,
      appName: typeof req.body?.appName === "string" ? req.body.appName : undefined,
      tagline: typeof req.body?.tagline === "string" ? req.body.tagline : undefined,
      hideMainstreetaiBranding:
        req.body?.hideMainstreetaiBranding === "on" || req.body?.hideMainstreetaiBranding === "true",
    };
    const parsed = tenantSettingsUpsertSchema.safeParse(payload);
    if (!parsed.success) {
      return res.redirect("/admin/tenant/settings?notice=Invalid%20settings%20payload");
    }
    await upsertOwnerTenantSettings(ownerId, parsed.data);
    return res.redirect("/admin/tenant/settings?notice=Tenant%20settings%20saved");
  } catch (error) {
    return next(error);
  }
});

export default router;
