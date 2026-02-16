import { Router } from "express";
import { communityEventNeedSchema, type CommunityEventNeed } from "../schemas/communityEventsSchema";
import { townBoardSourceSchema, townBoardStatusSchema, type TownBoardSource, type TownBoardStatus } from "../schemas/townBoardSchema";
import { listTownBoardPostsForModeration, moderateTownBoardPost } from "../services/townBoardService";
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

function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function sourceOptions(selected: TownBoardSource): string {
  return townBoardSourceSchema.options
    .map((entry) => {
      const isSelected = entry === selected ? "selected" : "";
      return `<option value="${escapeHtml(entry)}" ${isSelected}>${escapeHtml(entry)}</option>`;
    })
    .join("");
}

function statusBadge(status: TownBoardStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function parseNeeds(raw: unknown): CommunityEventNeed[] {
  if (Array.isArray(raw)) {
    const out: CommunityEventNeed[] = [];
    for (const value of raw) {
      const parsed = communityEventNeedSchema.safeParse(value);
      if (parsed.success && !out.includes(parsed.data)) {
        out.push(parsed.data);
      }
    }
    return out;
  }
  if (typeof raw !== "string") {
    return [];
  }
  const values = raw
    .split(/[,\n]/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const out: CommunityEventNeed[] = [];
  for (const value of values) {
    const mapped =
      value === "drink"
        ? "drinks"
        : value === "volunteer"
          ? "volunteers"
          : value === "sponsor"
            ? "sponsorship"
            : value;
    const parsed = communityEventNeedSchema.safeParse(mapped);
    if (parsed.success && !out.includes(parsed.data)) {
      out.push(parsed.data);
    }
  }
  return out;
}

function pageLayout(body: string, notice?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Town Board Moderation</title>
    <style>
      body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f8f5ef; color:#111827; }
      .wrap { max-width: 1040px; margin:0 auto; padding:18px; }
      .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .card { background:#fffdf9; border:1px solid #e2d7c8; border-radius:16px; box-shadow:0 8px 22px rgba(15, 23, 42, 0.05); padding:14px; margin-bottom:12px; }
      .chip { display:inline-flex; align-items:center; gap:6px; padding:6px 9px; border-radius:999px; background:#eef3fb; color:#1f4e79; font-size:12px; font-weight:700; }
      .button, button { border:1px solid #1f4e79; background:#1f4e79; color:#fff; border-radius:10px; padding:9px 12px; text-decoration:none; cursor:pointer; font-weight:700; }
      .button.secondary, button.secondary { background:#fff; color:#334155; border-color:#d8cdbd; }
      .button.warn, button.warn { background:#7f1d1d; border-color:#7f1d1d; }
      input, textarea, select { width:100%; box-sizing:border-box; border:1px solid #d8cdbd; border-radius:10px; padding:8px 10px; font:inherit; background:#fff; }
      textarea { min-height:76px; resize:vertical; }
      .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; }
      .field { display:grid; gap:6px; }
      .muted { color:#64748b; font-size:13px; }
      .status-note { margin-bottom:12px; padding:10px 12px; border-radius:10px; border:1px solid #d8cdbd; background:#fff; }
      @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main class="wrap">
      <div class="row" style="margin-bottom:12px;">
        <a class="button secondary" href="/app">Easy Mode</a>
        <a class="button secondary" href="/admin">Admin Home</a>
        <a class="button secondary" href="/admin/townboard">Town Board</a>
      </div>
      ${notice ? `<p class="status-note">${escapeHtml(notice)}</p>` : ""}
      ${body}
    </main>
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

router.get("/townboard", async (req, res, next) => {
  try {
    const filterRaw = typeof req.query.status === "string" ? req.query.status : "pending";
    const parsedFilter = townBoardStatusSchema.safeParse(filterRaw);
    const filter = parsedFilter.success ? parsedFilter.data : "pending";
    const [rows, recentApproved] = await Promise.all([
      listTownBoardPostsForModeration({
        status: filter,
        limit: 120,
      }),
      listTownBoardPostsForModeration({
        status: "approved",
        limit: 24,
      }),
    ]);
    const listHtml =
      rows.length === 0
        ? `<div class="card"><h2>No ${escapeHtml(filter)} town board posts right now.</h2><p class="muted">When community submissions arrive, they will appear here for review.</p></div>`
        : rows
            .map((post) => {
              const townLabel = post.townRegion ? `${post.townName}, ${post.townRegion}` : post.townName;
              return `<article class="card">
                <div class="row" style="justify-content:space-between;">
                  <div>
                    <h2 style="margin:0;">🪧 ${escapeHtml(post.title)}</h2>
                    <p class="muted">${escapeHtml(townLabel)} · ${escapeHtml(new Date(post.eventDate).toLocaleString())}</p>
                  </div>
                  <span class="chip">${escapeHtml(statusBadge(post.status))}</span>
                </div>
                <p class="muted" style="margin-top:8px;">Source: ${escapeHtml(post.source)} · Needs: ${escapeHtml(post.needs.join(", ") || "none listed")}</p>
                <form method="POST" action="/admin/townboard/${escapeHtml(encodeURIComponent(post.id))}/moderate" style="margin-top:10px;">
                  <div class="grid">
                    <label class="field">Source
                      <select name="source">${sourceOptions(post.source)}</select>
                    </label>
                    <label class="field">Date
                      <input name="date" type="datetime-local" value="${escapeHtml(toLocalDateTimeInput(post.eventDate))}" />
                    </label>
                    <label class="field">Event Name
                      <input name="title" value="${escapeHtml(post.title)}" />
                    </label>
                    <label class="field">Needs (comma separated)
                      <input name="needs" value="${escapeHtml(post.needs.join(", "))}" />
                    </label>
                    <label class="field">Contact info
                      <input name="contactInfo" value="${escapeHtml(post.contactInfo)}" />
                    </label>
                    <label class="field">Signup URL
                      <input name="signupUrl" value="${escapeHtml(post.signupUrl ?? "")}" />
                    </label>
                  </div>
                  <label class="field" style="margin-top:10px;">Description
                    <textarea name="description">${escapeHtml(post.description)}</textarea>
                  </label>
                  <div class="row" style="margin-top:10px;">
                    <button type="submit" name="action" value="save" class="secondary">Save Wording</button>
                    <button type="submit" name="action" value="approve">Approve + Publish</button>
                    <button type="submit" name="action" value="reject" class="warn">Mark Rejected</button>
                  </div>
                </form>
              </article>`;
            })
            .join("");
    const approvedHtml = recentApproved.length
      ? `<div class="card">
          <h2>Recently approved</h2>
          <p class="muted">These are already flowing into owner daily opportunities.</p>
          <ul>
            ${recentApproved
              .map(
                (post) =>
                  `<li>${escapeHtml(post.title)} · ${escapeHtml(post.townName)} · ${escapeHtml(new Date(post.eventDate).toLocaleDateString())}</li>`,
              )
              .join("")}
          </ul>
        </div>`
      : "";
    const statusOptions = townBoardStatusSchema.options
      .map((entry) => {
        const selected = entry === filter ? "selected" : "";
        return `<option value="${escapeHtml(entry)}" ${selected}>${escapeHtml(entry)}</option>`;
      })
      .join("");
    const body = `<section class="card">
        <h1>Town Board Moderation</h1>
        <p class="muted">Approve trusted community submissions, edit wording, and keep the board calm and helpful.</p>
        <form method="GET" action="/admin/townboard" class="row" style="margin-top:10px;">
          <label><strong>Status</strong></label>
          <select name="status">${statusOptions}</select>
          <button type="submit" class="secondary">Filter</button>
        </form>
      </section>
      ${listHtml}
      ${approvedHtml}`;
    const notice = typeof req.query.notice === "string" ? req.query.notice : undefined;
    return res.type("html").send(pageLayout(body, notice));
  } catch (error) {
    return next(error);
  }
});

router.post("/townboard/:postId/moderate", async (req, res) => {
  const postId = typeof req.params.postId === "string" ? req.params.postId : "";
  if (!postId) {
    return res.redirect("/admin/townboard?notice=Missing%20post%20id");
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const source = townBoardSourceSchema.safeParse(body.source);
  const action = typeof body.action === "string" ? body.action : "save";
  const status: TownBoardStatus | undefined =
    action === "approve" ? "approved" : action === "reject" ? "rejected" : undefined;
  try {
    await moderateTownBoardPost({
      postId,
      updates: {
        status,
        source: source.success ? source.data : undefined,
        title: typeof body.title === "string" && body.title.trim() ? body.title : undefined,
        date: typeof body.date === "string" && body.date.trim() ? body.date : undefined,
        needs: parseNeeds(body.needs),
        description: typeof body.description === "string" ? body.description : undefined,
        contactInfo:
          typeof body.contactInfo === "string" && body.contactInfo.trim() ? body.contactInfo : undefined,
        signupUrl: typeof body.signupUrl === "string" && body.signupUrl.trim() ? body.signupUrl : undefined,
      },
    });
    const notice =
      action === "approve"
        ? "Town board post approved and published."
        : action === "reject"
          ? "Town board post marked rejected."
          : "Town board post saved.";
    return res.redirect(`/admin/townboard?notice=${encodeURIComponent(notice)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not moderate town board post";
    return res.redirect(`/admin/townboard?notice=${encodeURIComponent(message)}`);
  }
});

export default router;
