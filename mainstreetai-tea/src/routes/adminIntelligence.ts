import { Router } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import {
  mediaAnalyzeRequestSchema,
  mediaAssetCreateSchema,
  mediaPlatformSchema,
  type MediaPlatform,
} from "../schemas/mediaSchema";
import { postNowRequestSchema } from "../schemas/postNowSchema";
import { getAdapter } from "../storage/getAdapter";
import { extractAuthToken, resolveAuthUser } from "../supabase/verifyAuth";
import { addMediaAsset, listMediaAnalysis, listMediaAssets } from "../services/mediaStore";
import { analyzeMediaForBrand } from "../services/visualIntelligenceService";
import { getTimingModel } from "../services/timingStore";
import { recomputeTimingModel, runPostNowCoach } from "../services/timingModelService";

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
      .wrap { max-width: 1060px; margin: 0 auto; padding: 20px; }
      .row { display:flex; gap:10px; flex-wrap: wrap; align-items:center; }
      .card { background:#fff; border:1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
      .button { border:1px solid #2563eb; background:#2563eb; color:#fff; border-radius:8px; padding:8px 12px; text-decoration:none; display:inline-block; cursor:pointer; }
      .button.secondary { background:#fff; color:#0f172a; border-color:#cbd5e1; }
      input, select, textarea { border:1px solid #cbd5e1; border-radius:8px; padding:8px; }
      textarea { min-height: 90px; width: 100%; box-sizing:border-box; }
      table { width:100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #e2e8f0; padding:8px; text-align:left; vertical-align: top; }
      .muted { color:#64748b; font-size:13px; }
      .pill { display:inline-block; border:1px solid #cbd5e1; border-radius:999px; padding:2px 8px; font-size:12px; margin-right:6px; }
      pre { background:#0f172a; color:#e2e8f0; border-radius:8px; padding:10px; overflow:auto; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="row" style="margin-bottom:12px;">
        <a class="button secondary" href="/admin">Admin Home</a>
        <a class="button secondary" href="/admin/media">Media</a>
        <a class="button secondary" href="/admin/timing">Timing</a>
        <a class="button secondary" href="/admin/post-now">Post Now</a>
        <a class="button secondary" href="/admin/voice">Voice</a>
        <a class="button secondary" href="/admin/locations">Locations</a>
      </div>
      ${body}
    </div>
    <script>
      document.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", async () => {
          const targetId = button.getAttribute("data-copy");
          const source = targetId ? document.getElementById(targetId) : null;
          if (!source) return;
          const text = source.value || source.textContent || "";
          try {
            await navigator.clipboard.writeText(text);
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = "Copy"; }, 1200);
          } catch {}
        });
      });
    </script>
  </body>
</html>`;
}

function selectedBrandId(raw: unknown, brandIds: string[]): string {
  if (typeof raw === "string" && brandIds.includes(raw)) {
    return raw;
  }
  return brandIds[0] ?? "";
}

function selectedPlatform(raw: unknown): MediaPlatform {
  const parsed = mediaPlatformSchema.safeParse(raw);
  return parsed.success ? parsed.data : "instagram";
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

router.get("/media", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const brandIds = brands.map((brand) => brand.brandId);
    const brandId = selectedBrandId(req.query.brandId, brandIds);
    const options = brands
      .map((brand) => {
        const selected = brand.brandId === brandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");
    if (!brandId) {
      return res
        .type("html")
        .send(render("Media", '<div class="card"><h1>Media</h1><p>Create a brand first.</p></div>'));
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access) {
      return res.status(404).type("html").send(render("Media", "<div class='card'>Brand not found.</div>"));
    }

    const [assets, analyses] = await Promise.all([
      listMediaAssets(access.ownerId, access.brandId, 30),
      listMediaAnalysis(access.ownerId, access.brandId, { limit: 20 }),
    ]);
    const notice =
      typeof req.query.notice === "string" && req.query.notice.trim() !== ""
        ? `<p class="muted">${escapeHtml(req.query.notice)}</p>`
        : "";

    const html = render(
      "Media",
      `
      <div class="card">
        <h1>Visual Content Intelligence</h1>
        <form method="GET" action="/admin/media" class="row">
          <label><strong>Brand</strong></label>
          <select name="brandId" onchange="this.form.submit()">${options}</select>
        </form>
        ${notice}
      </div>

      <div class="card">
        <h2>Add media asset (URL)</h2>
        <form method="POST" action="/admin/media/assets" class="row" style="align-items:flex-end;">
          <input type="hidden" name="brandId" value="${escapeHtml(brandId)}" />
          <label>Kind<br/>
            <select name="kind">
              <option value="image">image</option>
              <option value="video">video</option>
              <option value="thumbnail">thumbnail</option>
            </select>
          </label>
          <label>Source<br/>
            <select name="source">
              <option value="url">url</option>
              <option value="generated">generated</option>
            </select>
          </label>
          <label style="min-width:380px;">URL<br/><input name="url" placeholder="https://..." required /></label>
          <button class="button" type="submit">Save asset</button>
        </form>
        <p class="muted">Use upload-url API for signed uploads if running Supabase storage bucket.</p>
      </div>

      <div class="card">
        <h2>Recent assets</h2>
        <table>
          <thead><tr><th>Created</th><th>Kind</th><th>URL</th><th>Analyze</th></tr></thead>
          <tbody>
            ${
              assets.length > 0
                ? assets
                    .map(
                      (asset) => `
                        <tr>
                          <td>${escapeHtml(asset.createdAt)}</td>
                          <td>${escapeHtml(asset.kind)}</td>
                          <td><a href="${escapeHtml(asset.url)}" target="_blank" rel="noreferrer">open</a></td>
                          <td>
                            <form method="POST" action="/admin/media/analyze" class="row">
                              <input type="hidden" name="brandId" value="${escapeHtml(brandId)}" />
                              <input type="hidden" name="assetId" value="${escapeHtml(asset.id)}" />
                              <select name="platform">
                                <option value="instagram">instagram</option>
                                <option value="facebook">facebook</option>
                                <option value="tiktok">tiktok</option>
                                <option value="gbp">gbp</option>
                              </select>
                              <input name="goals" placeholder="new_customers,repeat_customers" />
                              <button class="button secondary" type="submit">Analyze</button>
                            </form>
                          </td>
                        </tr>`,
                    )
                    .join("")
                : '<tr><td colspan="4" class="muted">No assets yet.</td></tr>'
            }
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Recent analysis</h2>
        ${
          analyses.length > 0
            ? analyses
                .map((analysis, index) => {
                  const id = `analysis-${index}`;
                  const caption = `caption-${index}`;
                  const hooks = `hooks-${index}`;
                  const onscreen = `onscreen-${index}`;
                  return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:10px;">
                    <div class="row">
                      <span class="pill">${escapeHtml(analysis.platform)}</span>
                      <span class="muted">${escapeHtml(analysis.createdAt)}</span>
                    </div>
                    <p><strong>Score:</strong> ${escapeHtml(String(analysis.analysis.quickScore))}/10</p>
                    <div class="row">
                      <textarea id="${caption}">${escapeHtml(analysis.analysis.captionRewrite)}</textarea>
                      <button type="button" class="button secondary" data-copy="${caption}">Copy</button>
                    </div>
                    <div class="row">
                      <textarea id="${hooks}">${escapeHtml((analysis.analysis.hookIdeas ?? []).join("\n"))}</textarea>
                      <button type="button" class="button secondary" data-copy="${hooks}">Copy</button>
                    </div>
                    <div class="row">
                      <textarea id="${onscreen}">${escapeHtml(
                        (analysis.analysis.onScreenTextOptions ?? []).join("\n"),
                      )}</textarea>
                      <button type="button" class="button secondary" data-copy="${onscreen}">Copy</button>
                    </div>
                    <details>
                      <summary>Raw analysis JSON</summary>
                      <pre id="${id}">${escapeHtml(JSON.stringify(analysis.analysis, null, 2))}</pre>
                    </details>
                  </div>`;
                })
                .join("")
            : "<p class='muted'>No analyses yet.</p>"
        }
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/media/assets", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    if (!brandId) {
      return res.redirect("/admin/media?notice=Missing%20brandId");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access) {
      return res.redirect(`/admin/media?brandId=${encodeURIComponent(brandId)}&notice=Brand%20not%20found`);
    }
    const payload = {
      kind: req.body?.kind,
      source: req.body?.source,
      url: req.body?.url,
    };
    const parsed = mediaAssetCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return res.redirect(`/admin/media?brandId=${encodeURIComponent(brandId)}&notice=Invalid%20asset%20payload`);
    }
    await addMediaAsset(access.ownerId, access.brandId, parsed.data);
    return res.redirect(`/admin/media?brandId=${encodeURIComponent(brandId)}&notice=Asset%20saved`);
  } catch (error) {
    return next(error);
  }
});

router.post("/media/analyze", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    if (!brandId) {
      return res.redirect("/admin/media?notice=Missing%20brandId");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access) {
      return res.redirect(`/admin/media?brandId=${encodeURIComponent(brandId)}&notice=Brand%20not%20found`);
    }
    const goals =
      typeof req.body?.goals === "string"
        ? req.body.goals
            .split(",")
            .map((entry: string) => entry.trim())
            .filter((entry: string) => entry.length > 0)
        : ["repeat_customers"];
    const parsed = mediaAnalyzeRequestSchema.safeParse({
      assetId: req.body?.assetId,
      platform: req.body?.platform,
      goals,
      imageContext: req.body?.imageContext,
    });
    if (!parsed.success) {
      return res.redirect(`/admin/media?brandId=${encodeURIComponent(brandId)}&notice=Invalid%20analyze%20payload`);
    }
    await analyzeMediaForBrand({
      userId: access.ownerId,
      brandId: access.brandId,
      request: parsed.data,
    });
    return res.redirect(`/admin/media?brandId=${encodeURIComponent(brandId)}&notice=Analysis%20complete`);
  } catch (error) {
    return next(error);
  }
});

router.get("/timing", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const brandIds = brands.map((brand) => brand.brandId);
    const brandId = selectedBrandId(req.query.brandId, brandIds);
    const platform = selectedPlatform(req.query.platform);
    const options = brands
      .map((brand) => {
        const selected = brand.brandId === brandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");
    if (!brandId) {
      return res
        .type("html")
        .send(render("Timing", '<div class="card"><h1>Timing</h1><p>Create a brand first.</p></div>'));
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access) {
      return res.status(404).type("html").send(render("Timing", "<div class='card'>Brand not found.</div>"));
    }
    const model = await getTimingModel(access.ownerId, access.brandId, platform);
    const notice =
      typeof req.query.notice === "string" && req.query.notice.trim() !== ""
        ? `<p class="muted">${escapeHtml(req.query.notice)}</p>`
        : "";
    const modelHtml = model
      ? `<p><strong>Best time label:</strong> ${escapeHtml(model.model.bestTimeLabel)}</p>
         <p><strong>Best hours:</strong> ${escapeHtml(model.model.bestHours.join(", "))}</p>
         <p><strong>Best days (0=Sun):</strong> ${escapeHtml(model.model.bestDays.join(", "))}</p>
         <p><strong>Sample size:</strong> ${escapeHtml(String(model.model.sampleSize))}</p>
         <pre>${escapeHtml(JSON.stringify(model.model, null, 2))}</pre>`
      : "<p class='muted'>No model yet for this platform. Click recompute.</p>";

    const html = render(
      "Timing",
      `
      <div class="card">
        <h1>Predictive Timing</h1>
        <form method="GET" action="/admin/timing" class="row">
          <label>Brand<br/><select name="brandId">${options}</select></label>
          <label>Platform<br/>
            <select name="platform">
              <option value="instagram" ${platform === "instagram" ? "selected" : ""}>instagram</option>
              <option value="facebook" ${platform === "facebook" ? "selected" : ""}>facebook</option>
              <option value="tiktok" ${platform === "tiktok" ? "selected" : ""}>tiktok</option>
              <option value="gbp" ${platform === "gbp" ? "selected" : ""}>gbp</option>
              <option value="other" ${platform === "other" ? "selected" : ""}>other</option>
            </select>
          </label>
          <button class="button secondary" type="submit">Load</button>
        </form>
        ${notice}
      </div>
      <div class="card">
        <form method="POST" action="/admin/timing/recompute" class="row">
          <input type="hidden" name="brandId" value="${escapeHtml(brandId)}" />
          <input type="hidden" name="platform" value="${escapeHtml(platform)}" />
          <label>Range days<br/><input name="rangeDays" value="60" /></label>
          <button class="button" type="submit">Recompute timing model</button>
        </form>
      </div>
      <div class="card">${modelHtml}</div>
      <div class="card">
        <h2>Post now coach</h2>
        <form method="GET" action="/admin/post-now" class="row">
          <input type="hidden" name="brandId" value="${escapeHtml(brandId)}" />
          <input type="hidden" name="platform" value="${escapeHtml(platform)}" />
          <button class="button secondary" type="submit">Open post-now coach</button>
        </form>
      </div>
      `,
    );
    return res.type("html").send(html);
  } catch (error) {
    return next(error);
  }
});

router.post("/timing/recompute", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brandId = typeof req.body?.brandId === "string" ? req.body.brandId.trim() : "";
    const platform = selectedPlatform(req.body?.platform);
    const rangeDaysRaw =
      typeof req.body?.rangeDays === "string" ? Number.parseInt(req.body.rangeDays, 10) : 60;
    const rangeDays = Number.isFinite(rangeDaysRaw) ? rangeDaysRaw : 60;
    if (!brandId) {
      return res.redirect("/admin/timing?notice=Missing%20brandId");
    }
    const access = await resolveBrandAccess(actorId, brandId);
    if (!access) {
      return res.redirect(`/admin/timing?brandId=${encodeURIComponent(brandId)}&notice=Brand%20not%20found`);
    }
    await recomputeTimingModel({
      userId: access.ownerId,
      brandId: access.brandId,
      platform,
      rangeDays,
    });
    return res.redirect(
      `/admin/timing?brandId=${encodeURIComponent(brandId)}&platform=${encodeURIComponent(
        platform,
      )}&notice=Timing%20model%20updated`,
    );
  } catch (error) {
    return next(error);
  }
});

function renderPostNowPage(input: {
  brandOptionsHtml: string;
  brandId: string;
  platform: MediaPlatform;
  notice?: string;
  todayNotes?: string;
  draftCaption?: string;
  decision?: Awaited<ReturnType<typeof runPostNowCoach>>["decision"];
}): string {
  const captionId = "post-now-caption";
  return render(
    "Post Now",
    `
      <div class="card">
        <h1>Post Now? Real-time Coach</h1>
        ${input.notice ? `<p class="muted">${escapeHtml(input.notice)}</p>` : ""}
        <form method="POST" action="/admin/post-now">
          <div class="row">
            <label>Brand<br/><select name="brandId">${input.brandOptionsHtml}</select></label>
            <label>Platform<br/>
              <select name="platform">
                <option value="instagram" ${input.platform === "instagram" ? "selected" : ""}>instagram</option>
                <option value="facebook" ${input.platform === "facebook" ? "selected" : ""}>facebook</option>
                <option value="tiktok" ${input.platform === "tiktok" ? "selected" : ""}>tiktok</option>
                <option value="gbp" ${input.platform === "gbp" ? "selected" : ""}>gbp</option>
                <option value="other" ${input.platform === "other" ? "selected" : ""}>other</option>
              </select>
            </label>
          </div>
          <label>Today notes<br/><textarea name="todayNotes">${escapeHtml(input.todayNotes ?? "")}</textarea></label>
          <label>Draft caption (optional)<br/><textarea name="draftCaption">${escapeHtml(
            input.draftCaption ?? "",
          )}</textarea></label>
          <div style="margin-top:10px;"><button class="button" type="submit">Run coach</button></div>
        </form>
      </div>
      ${
        input.decision
          ? `<div class="card">
              <h2>Decision: ${input.decision.postNow ? "Post now" : "Wait"}</h2>
              <p><strong>Confidence:</strong> ${escapeHtml(String(input.decision.confidence))}</p>
              <p><strong>Best time today:</strong> ${escapeHtml(input.decision.bestTimeToday)}</p>
              <p><strong>Why:</strong> ${escapeHtml(input.decision.why)}</p>
              <h3>What to post</h3>
              <p><strong>Hook:</strong> ${escapeHtml(input.decision.whatToPost.hook)}</p>
              <textarea id="${captionId}">${escapeHtml(input.decision.whatToPost.caption)}</textarea>
              <button type="button" class="button secondary" data-copy="${captionId}">Copy caption</button>
              <p><strong>On-screen text:</strong><br/>${escapeHtml(
                input.decision.whatToPost.onScreenText.join(" | "),
              )}</p>
              <p><strong>Backup plan:</strong> ${escapeHtml(input.decision.backupPlan)}</p>
            </div>`
          : ""
      }
    `,
  );
}

router.get("/post-now", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const brandIds = brands.map((brand) => brand.brandId);
    const brandId = selectedBrandId(req.query.brandId, brandIds);
    const platform = selectedPlatform(req.query.platform);
    const options = brands
      .map((brand) => {
        const selected = brand.brandId === brandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");
    return res
      .type("html")
      .send(
        renderPostNowPage({
          brandOptionsHtml: options,
          brandId,
          platform,
          notice:
            typeof req.query.notice === "string" && req.query.notice.trim() !== ""
              ? req.query.notice
              : undefined,
        }),
      );
  } catch (error) {
    return next(error);
  }
});

router.post("/post-now", async (req, res, next) => {
  try {
    const actorId = req.user?.id;
    if (!actorId) {
      return res.redirect("/admin/login");
    }
    const brands = await getAdapter().listBrands(actorId);
    const brandIds = brands.map((brand) => brand.brandId);
    const brandId = selectedBrandId(req.body?.brandId, brandIds);
    const platform = selectedPlatform(req.body?.platform);
    const options = brands
      .map((brand) => {
        const selected = brand.brandId === brandId ? "selected" : "";
        return `<option value="${escapeHtml(brand.brandId)}" ${selected}>${escapeHtml(
          brand.businessName,
        )}</option>`;
      })
      .join("");

    if (!brandId) {
      return res.type("html").send(
        renderPostNowPage({
          brandOptionsHtml: options,
          brandId: "",
          platform,
          notice: "Create a brand first.",
        }),
      );
    }

    const access = await resolveBrandAccess(actorId, brandId);
    if (!access) {
      return res.type("html").send(
        renderPostNowPage({
          brandOptionsHtml: options,
          brandId,
          platform,
          notice: "Brand not found.",
        }),
      );
    }

    const parsed = postNowRequestSchema.safeParse({
      platform,
      todayNotes: req.body?.todayNotes,
      draftCaption: req.body?.draftCaption,
    });
    if (!parsed.success) {
      return res.type("html").send(
        renderPostNowPage({
          brandOptionsHtml: options,
          brandId,
          platform,
          todayNotes: req.body?.todayNotes,
          draftCaption: req.body?.draftCaption,
          notice: "Invalid payload for post-now coach.",
        }),
      );
    }
    const result = await runPostNowCoach({
      userId: access.ownerId,
      brandId: access.brandId,
      request: parsed.data,
    });
    return res.type("html").send(
      renderPostNowPage({
        brandOptionsHtml: options,
        brandId,
        platform,
        todayNotes: parsed.data.todayNotes,
        draftCaption: parsed.data.draftCaption,
        decision: result.decision,
      }),
    );
  } catch (error) {
    return next(error);
  }
});

export default router;
