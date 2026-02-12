import { z } from "zod";
import { brandLocalTrustStyleSchema } from "./brandSchema";

export const localTrustVoiceOutputSchema = z.object({
  trustLine: z.string().min(1),
});

export const localTrustAssetsSchema = z.object({
  windowStickerSVG: z.string().min(1),
  socialBadgePNG: z.string().min(1),
  receiptLine: z.string().min(1),
});

export const localTrustBadgeLabelSchema = z.enum([
  "Powered by Main Street",
  "Local Network Member",
]);

export const localTrustStyleSchema = brandLocalTrustStyleSchema;

export type LocalTrustAssets = z.infer<typeof localTrustAssetsSchema>;
