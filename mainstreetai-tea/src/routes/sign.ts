import { Router } from "express";
import PDFDocument from "pdfkit";
import { getBrand } from "../data/brandStore";
import { brandIdSchema } from "../schemas/brandSchema";
import { historyRecordSchema } from "../schemas/historySchema";
import { localJsonStore } from "../storage/localJsonStore";

const router = Router();

type SignContent = {
  promoName: string;
  offer: string;
  when: string;
  inStoreLine: string;
  followLine: string;
};

function getStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pickFromObject(obj: unknown, key: string): string | null {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  return getStringValue((obj as Record<string, unknown>)[key]);
}

function deriveSignFromHistoryResponse(response: unknown): Partial<SignContent> {
  const promoName = pickFromObject(response, "promoName");
  const offer = pickFromObject(response, "offer");
  const when = pickFromObject(response, "when") ?? pickFromObject(response, "timeWindow");
  const inStoreLine = pickFromObject(response, "inStoreSign");

  if (promoName || offer || when || inStoreLine) {
    return {
      promoName: promoName ?? undefined,
      offer: offer ?? undefined,
      when: when ?? undefined,
      inStoreLine: inStoreLine ?? undefined,
    };
  }

  if (typeof response === "object" && response !== null && Array.isArray((response as { dailyPlan?: unknown }).dailyPlan)) {
    const firstDay = (response as { dailyPlan: unknown[] }).dailyPlan[0];
    return {
      promoName: pickFromObject(firstDay, "promoName") ?? undefined,
      offer: pickFromObject(firstDay, "offer") ?? undefined,
      when: pickFromObject(firstDay, "timeWindow") ?? undefined,
      inStoreLine: pickFromObject(firstDay, "inStoreSign") ?? undefined,
    };
  }

  return {};
}

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /sign.pdf?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  try {
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const historyId = getStringValue(req.query.historyId);
    let historyDerived: Partial<SignContent> = {};

    if (historyId) {
      const record = await localJsonStore.getBrandRecordById<unknown>({
        collection: "history",
        brandId: parsedBrandId.data,
        id: historyId,
      });

      if (!record) {
        return res.status(404).json({ error: `History record '${historyId}' was not found` });
      }

      const parsedRecord = historyRecordSchema.safeParse(record);
      if (!parsedRecord.success) {
        return res.status(400).json({ error: `History record '${historyId}' could not be used for a sign` });
      }

      historyDerived = deriveSignFromHistoryResponse(parsedRecord.data.response);
    }

    const signContent: SignContent = {
      promoName:
        getStringValue(req.query.promoName) ??
        historyDerived.promoName ??
        "Today's Special",
      offer:
        getStringValue(req.query.offer) ??
        historyDerived.offer ??
        "Ask us about today's offer!",
      when:
        getStringValue(req.query.when) ??
        historyDerived.when ??
        "Today",
      inStoreLine:
        getStringValue(req.query.line) ??
        historyDerived.inStoreLine ??
        "We appreciate your support, neighbors.",
      followLine: getStringValue(req.query.followLine) ?? "Follow us on IG: @_____",
    };

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const safeBusinessName = brand.businessName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeBusinessName}-in-store-sign.pdf"`,
    );

    doc.pipe(res);
    doc.fontSize(30).text(brand.businessName, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(16).fillColor("#555555").text(brand.location, { align: "center" });
    doc.moveDown(1.5);

    doc.fillColor("#000000");
    doc.fontSize(26).text(signContent.promoName, { align: "center" });
    doc.moveDown(0.7);
    doc.fontSize(22).text(signContent.offer, { align: "center" });
    doc.moveDown(0.9);
    doc.fontSize(16).text(`When: ${signContent.when}`, { align: "center" });
    doc.moveDown(1.2);
    doc.fontSize(14).text(signContent.inStoreLine, {
      align: "center",
      width: 500,
    });

    doc.moveDown(2);
    doc.fontSize(12).fillColor("#333333").text(signContent.followLine, {
      align: "center",
    });

    doc.end();
    return undefined;
  } catch (error) {
    return next(error);
  }
});

export default router;
