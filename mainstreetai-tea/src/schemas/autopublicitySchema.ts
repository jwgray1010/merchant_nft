import { z } from "zod";

export const autopublicityPackSchema = z.object({
  masterCaption: z.string().min(1),
  facebookCaption: z.string().min(1),
  instagramCaption: z.string().min(1),
  twitterCaption: z.string().min(1),
  googleCaption: z.string().min(1),
  tiktokHook: z.string().min(1),
  snapchatText: z.string().min(1),
});

export const autopublicityJobStatusSchema = z.enum(["draft", "posting", "posted"]);

export const autopublicityJobRowSchema = z.object({
  id: z.string().min(1),
  brandRef: z.string().min(1),
  mediaUrl: z.string().url(),
  status: autopublicityJobStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const autopublicityChannelsSchema = z
  .object({
    facebook: z.boolean().default(true),
    instagram: z.boolean().default(true),
    google: z.boolean().default(true),
    x: z.boolean().default(true),
    tiktok: z.boolean().default(false),
    snapchat: z.boolean().default(false),
  })
  .default({
    facebook: true,
    instagram: true,
    google: true,
    x: true,
    tiktok: false,
    snapchat: false,
  });

export const autopublicityRequestSchema = z.object({
  mediaUrl: z.string().url(),
  captionIdea: z.string().trim().max(400).optional(),
  channels: autopublicityChannelsSchema.optional(),
  confirmPost: z.boolean().default(false),
  locationId: z.string().trim().min(1).optional(),
  cameraMode: z.boolean().default(false),
});

export type AutopublicityPack = z.infer<typeof autopublicityPackSchema>;
export type AutopublicityJobStatus = z.infer<typeof autopublicityJobStatusSchema>;
export type AutopublicityJobRow = z.infer<typeof autopublicityJobRowSchema>;
export type AutopublicityChannels = z.infer<typeof autopublicityChannelsSchema>;
export type AutopublicityRequest = z.infer<typeof autopublicityRequestSchema>;
