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

export async function buildDigestPreview(
  userId: string,
  brandId: string,
  cadence: "weekly" | "daily" = "weekly",
): Promise<{ subject: string; html: string; text: string }> {
  const adapter = getAdapter();
  const brand = await adapter.getBrand(userId, brandId);
  if (!brand) {
    throw new Error(`Brand '${brandId}' was not found`);
  }

  const learning = await generateInsightsForUser(userId, brand);
  const weekPlan = await runPrompt({
    promptFile: "next_week_plan.md",
    brandProfile: brand,
    input: {
      startDate: nextMondayIsoDate(),
      goal: "repeat_customers",
      brand,
      insights: learning.insights,
      previousWeekPlans: learning.previousWeekPlans,
      recentTopPosts: learning.recentTopPosts,
      notes: `Email digest cadence: ${cadence}`,
    },
    outputSchema: weekPlanOutputSchema,
  });

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
    )}</p>

    <h2>What worked</h2>
    <p>${escapeHtml(learning.insights.summary)}</p>
    <ul>
      ${learning.insights.whatToRepeat.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>

    <h2>What to avoid</h2>
    <ul>
      ${learning.insights.whatToAvoid.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>

    <h2>Next week plan: ${escapeHtml(weekPlan.weekTheme)}</h2>
    <ol>
      ${weekPlan.dailyPlan
        .map(
          (day) =>
            `<li>
              <strong>${escapeHtml(day.dayLabel)} (${escapeHtml(day.date)}):</strong> ${escapeHtml(
                day.promoName,
              )}<br />
              Offer: ${escapeHtml(day.offer)}<br />
              Time: ${escapeHtml(day.timeWindow)}<br />
              Staff note: ${escapeHtml(day.staffNotes)}
            </li>`,
        )
        .join("")}
    </ol>
  </body>
</html>`;

  const text = [
    subject,
    "",
    `Summary: ${learning.insights.summary}`,
    "",
    "What to repeat:",
    ...learning.insights.whatToRepeat.map((item) => `- ${item}`),
    "",
    "What to avoid:",
    ...learning.insights.whatToAvoid.map((item) => `- ${item}`),
    "",
    `Next week theme: ${weekPlan.weekTheme}`,
    ...weekPlan.dailyPlan.map((day) => `- ${day.dayLabel}: ${day.promoName} (${day.offer})`),
  ].join("\n");

  return { subject, html, text };
}
