import type { RequestHandler } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { getAdapter } from "../storage/getAdapter";

export type GenerationEndpoint = "promo" | "social" | "events" | "week-plan" | "next-week-plan";

function parseOptionalTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return tags.length > 0 ? tags : undefined;
}

export function createGenerationHistoryMiddleware(endpoint: GenerationEndpoint): RequestHandler {
  return (req, res, next) => {
    let responseBody: unknown;
    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.on("finish", () => {
      if (req.method !== "POST") {
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return;
      }

      const rawBrandId = req.query.brandId;
      if (typeof rawBrandId !== "string") {
        return;
      }

      const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
      if (!parsedBrandId.success) {
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        return;
      }

      const tags = parseOptionalTags((req.body as { tags?: unknown } | undefined)?.tags);

      void getAdapter()
        .addHistory(
          userId,
          parsedBrandId.data,
          endpoint,
          req.body,
          responseBody,
          tags,
        )
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown history logging error";
          console.error(`History logging failed: ${message}`);
        });
    });

    next();
  };
}
