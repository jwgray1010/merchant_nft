import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { listScheduleItems } from "../data/scheduleStore";
import { brandIdSchema } from "../schemas/brandSchema";

const router = Router();

function parseOptionalIso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

function toIcsDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error:
        "Missing brandId query parameter. Example: /schedule.ics?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const from = parseOptionalIso(req.query.from);
  const to = parseOptionalIso(req.query.to);

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const items = await listScheduleItems(parsedBrandId.data, { from, to });
    const nowStamp = toIcsDate(new Date().toISOString());

    const events = items.map((item) => {
      const summary = `Post to ${item.platform[0].toUpperCase()}${item.platform.slice(
        1,
      )} — ${brand.businessName}`;
      const descriptionLines = [
        `Title: ${item.title}`,
        `Status: ${item.status}`,
        "",
        "Caption:",
        item.caption,
        "",
        "Asset notes:",
        item.assetNotes || "None",
      ];
      const description = descriptionLines.join("\n");

      return [
        "BEGIN:VEVENT",
        `UID:${escapeIcsText(item.id)}@mainstreetai.local`,
        `DTSTAMP:${nowStamp}`,
        `DTSTART:${toIcsDate(item.scheduledFor)}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        "END:VEVENT",
      ].join("\r\n");
    });

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MainStreetAI//Schedule Export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...events,
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${parsedBrandId.data}-schedule.ics"`,
    );
    return res.send(ics);
  } catch (error) {
    return next(error);
  }
});

export default router;
