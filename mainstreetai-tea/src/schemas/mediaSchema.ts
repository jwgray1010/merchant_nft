import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const mediaKindSchema = z.enum(["image", "video", "thumbnail"]);
export const mediaSourceSchema = z.enum(["upload", "url", "generated"]);
export const mediaPlatformSchema = z.enum(["instagram", "facebook", "tiktok", "gbp", "other"]);
export const visualGoalSchema = z.enum(["new_customers", "repeat_customers", "slow_hours"]);

export const mediaAssetSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  locationId: z.string().optional(),
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const mediaAssetCreateSchema = z.object({
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  locationId: z.string().optional(),
  platform: mediaPlatformSchema.optional(),
});

export const visualReviewOutputSchema = z.object({
  quickScore: z.number().min(1).max(10),
  whatWorks: z.array(z.string()).min(1).max(6),
  whatHurts: z.array(z.string()).min(1).max(6),
  croppingSuggestions: z.array(z.string()).min(1).max(4),
  lightingSuggestions: z.array(z.string()).min(1).max(4),
  onScreenTextOptions: z.array(z.string()).min(3).max(6),
  hookIdeas: z.array(z.string()).min(3).max(6),
  captionRewrite: z.string().min(1),
  hashtags: z.array(z.string()).min(3).max(8),
});

export const cameraPlatformCaptionsSchema = z.object({
  masterCaption: z.string().min(1),
  facebookCaption: z.string().min(1),
  instagramCaption: z.string().min(1),
  twitterCaption: z.string().min(1),
  googleCaption: z.string().min(1),
  tiktokHook: z.string().min(1),
  snapchatText: z.string().min(1),
});

export const cameraCaptionOutputSchema = z.object({
  sceneDescription: z.string().min(1),
  captionIdea: z.string().min(1),
  platformCaptions: cameraPlatformCaptionsSchema,
  signText: z.string().min(1),
});

export const mediaAnalysisSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  assetId: z.string().min(1),
  platform: mediaPlatformSchema,
  analysis: visualReviewOutputSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const mediaAnalyzeRequestSchema = z
  .object({
    assetId: z.string().optional(),
    imageUrl: z.string().url().optional(),
    platform: mediaPlatformSchema,
    goals: z.array(visualGoalSchema).min(1).max(3),
    imageContext: z.string().optional(),
    mediaKind: mediaKindSchema.optional(),
    cameraMode: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.assetId || value.imageUrl), {
    message: "assetId or imageUrl is required",
    path: ["assetId"],
  });

export const mediaUploadUrlRequestSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  kind: mediaKindSchema.optional(),
  locationId: z.string().optional(),
});

export const mediaUploadUrlResponseSchema = z.object({
  signedUrl: z.string().url(),
  publicUrl: z.string().url(),
  assetId: z.string().min(1),
});

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaAssetCreate = z.infer<typeof mediaAssetCreateSchema>;
export type MediaAnalysis = z.infer<typeof mediaAnalysisSchema>;
export type MediaAnalyzeRequest = z.infer<typeof mediaAnalyzeRequestSchema>;
export type VisualReviewOutput = z.infer<typeof visualReviewOutputSchema>;
export type CameraCaptionOutput = z.infer<typeof cameraCaptionOutputSchema>;
export type MediaPlatform = z.infer<typeof mediaPlatformSchema>;
export type MediaUploadUrlRequest = z.infer<typeof mediaUploadUrlRequestSchema>;
