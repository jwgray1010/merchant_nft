import { Router } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import { getSubscriptionForBrand } from "../billing/subscriptions";
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

export default router;
