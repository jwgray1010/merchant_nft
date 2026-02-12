import { runPrompt } from "../ai/runPrompt";
import { weekPlanOutputSchema } from "../schemas/weekPlanOutputSchema";
import { generateInsightsForUser } from "./insightsService";
import { getAdapter } from "../storage/getAdapter";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nextMondayIsoDate(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  date.setDate(date.getDate() + daysUntilNextMonday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayPart = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayPart}`;
}

function isWithinRangeDays(iso: string, rangeDays: number): boolean {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const cutoffMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= cutoffMs;
}

function snippet(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function safeList(items: string[], fallback = "No data yet"): string[] {
  return items.length > 0 ? items : [fallback];
}

function topPostsRows(
  posts: Array<Record<string, unknown>>,
): Array<{ platform: string; caption: string; metric: string }> {
  return posts.slice(0, 3).map((entry) => {
    const platform = typeof entry.platform === "string" ? entry.platform : "unknown";
    const caption =
      typeof entry.captionUsed === "string"
        ? entry.captionUsed
        : typeof entry.caption === "string"
          ? entry.caption
          : "";
    const metrics = typeof entry.metrics === "object" && entry.metrics !== null ? entry.metrics : null;
    const metricText =
      metrics && "views" in metrics
        ? `Views: ${String((metrics as Record<string, unknown>).views ?? "-")}, Likes: ${String((metrics as Record<string, unknown>).likes ?? "-")}`
        : "Manual metrics not linked";
    return {
      platform,
      caption: caption || "No caption captured",
      metric: metricText,
    };
  });
}

function buildActions(
  insights: {
    whatToRepeat: string[];
    whatToAvoid: string[];
    next7DaysFocus: string;
  },
  topPosts: Array<{ platform: string; caption: string }>,
): string[] {
  const actions: string[] = [];
  actions.push(`Repeat this winning pattern: ${safeList(insights.whatToRepeat)[0]}`);
  if (topPosts.length > 0) {
    actions.push(
      `Rework the top ${topPosts[0].platform} post angle: "${snippet(topPosts[0].caption, 80)}"`,
    );
  } else {
    actions.push("Post at least 3 times this week so we can learn what resonates.");
  }
  actions.push(`Avoid this weak pattern: ${safeList(insights.whatToAvoid)[0]}`);
  return actions.slice(0, 3);
}

export type DigestPreviewOptions = {
  cadence?: "weekly" | "daily";
  rangeDays?: number;
  includeNextWeekPlan?: boolean;
  notes?: string;
};

export async function buildDigestPreview(
  userId: string,
  brandId: string,
  options: DigestPreviewOptions = {},
): Promise<{
  subject: string;
  html: string;
  textSummary: string;
  actions: string[];
}> {
  const cadence = options.cadence ?? "weekly";
  const rangeDays = options.rangeDays ?? 14;
  const includeNextWeekPlan = options.includeNextWeekPlan ?? true;
  const adapter = getAdapter();
  const brand = await adapter.getBrand(userId, brandId);
  if (!brand) {
    throw new Error(`Brand '${brandId}' was not found`);
  }

  const learning = await generateInsightsForUser(userId, brand);
  const recentTopPosts = learning.recentTopPosts.filter((entry) => {
    const postedAt = typeof entry.postedAt === "string" ? entry.postedAt : "";
    return postedAt ? isWithinRangeDays(postedAt, rangeDays) : true;
  });
  const topRows = topPostsRows(recentTopPosts);
  const actions = buildActions(
    {
      whatToRepeat: learning.insights.whatToRepeat,
      whatToAvoid: learning.insights.whatToAvoid,
      next7DaysFocus: learning.insights.next7DaysFocus,
    },
    topRows.map((row) => ({ platform: row.platform, caption: row.caption })),
  );

  const weekPlan = includeNextWeekPlan
    ? await runPrompt({
        promptFile: "next_week_plan.md",
        brandProfile: brand,
        input: {
          startDate: nextMondayIsoDate(),
          goal: "repeat_customers",
          brand,
          insights: learning.insights,
          previousWeekPlans: learning.previousWeekPlans,
          recentTopPosts: learning.recentTopPosts,
          notes: `Email digest cadence: ${cadence}${options.notes ? `. Notes: ${options.notes}` : ""}`,
        },
        outputSchema: weekPlanOutputSchema,
      })
    : null;

  const subject = `${brand.businessName}: ${cadence === "weekly" ? "Weekly" : "Daily"} marketing digest`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 20px; color: #111827;">
    <h1 style="margin-bottom: 6px;">${escapeHtml(brand.businessName)} Digest</h1>
    <p style="color: #6b7280; margin-top: 0;">${escapeHtml(brand.location)} · Cadence: ${escapeHtml(
      cadence,
    )} · Lookback: ${rangeDays} days</p>

    <h2>What worked</h2>
    <p>${escapeHtml(learning.insights.summary)}</p>
    <p><strong>Top hooks</strong>: ${escapeHtml(safeList(learning.insights.topHooks).join(" • "))}</p>
    <p><strong>Top offers</strong>: ${escapeHtml(safeList(learning.insights.topOffers).join(" • "))}</p>

    <h2>Top posts + metric highlights</h2>
    <table style="width:100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:8px;">Platform</th>
          <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:8px;">Post</th>
          <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:8px;">Highlights</th>
        </tr>
      </thead>
      <tbody>
        ${
          topRows.length > 0
            ? topRows
                .map(
                  (row) => `<tr>
                    <td style="padding:8px; border-bottom:1px solid #f3f4f6;">${escapeHtml(row.platform)}</td>
                    <td style="padding:8px; border-bottom:1px solid #f3f4f6;">${escapeHtml(snippet(row.caption, 120))}</td>
                    <td style="padding:8px; border-bottom:1px solid #f3f4f6;">${escapeHtml(row.metric)}</td>
                  </tr>`,
                )
                .join("")
            : `<tr><td colspan="3" style="padding:8px;">No top posts captured yet.</td></tr>`
        }
      </tbody>
    </table>

    <h2>What to avoid</h2>
    <ul>
      ${learning.insights.whatToAvoid.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>

    ${
      weekPlan
        ? `<h2>Next 7 days plan: ${escapeHtml(weekPlan.weekTheme)}</h2>
    <ol>
      ${weekPlan.dailyPlan
        .map(
          (day) =>
            `<li>
              <strong>${escapeHtml(day.dayLabel)} (${escapeHtml(day.date)}):</strong> ${escapeHtml(
                day.promoName,
              )}<br />
              Offer: ${escapeHtml(day.offer)} · Time: ${escapeHtml(day.timeWindow)}
            </li>`,
        )
        .join("")}
    </ol>`
        : ""
    }

    <h2>3 actions to take this week</h2>
    <ol>${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>

    ${
      options.notes
        ? `<p style="color:#6b7280;"><strong>Owner notes:</strong> ${escapeHtml(options.notes)}</p>`
        : ""
    }
  </body>
</html>`;

  const textSummary = [
    subject,
    "",
    `Summary: ${learning.insights.summary}`,
    "",
    "Top hooks:",
    ...safeList(learning.insights.topHooks).map((item) => `- ${item}`),
    "",
    "Top offers:",
    ...safeList(learning.insights.topOffers).map((item) => `- ${item}`),
    "",
    "What to repeat:",
    ...learning.insights.whatToRepeat.map((item) => `- ${item}`),
    "",
    "What to avoid:",
    ...learning.insights.whatToAvoid.map((item) => `- ${item}`),
    "",
    ...(weekPlan
      ? [
          `Next week theme: ${weekPlan.weekTheme}`,
          ...weekPlan.dailyPlan.map((day) => `- ${day.dayLabel}: ${day.promoName} (${day.offer})`),
          "",
        ]
      : []),
    "3 actions this week:",
    ...actions.map((item) => `- ${item}`),
  ].join("\n");

  return { subject, html, textSummary, actions };
}
