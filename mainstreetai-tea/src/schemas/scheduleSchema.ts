import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const schedulePlatformSchema = z.enum(["facebook", "instagram", "tiktok", "other"]);
export const scheduleStatusSchema = z.enum(["planned", "posted", "skipped"]);

export const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Must be a valid ISO date-time string",
});

export const scheduleItemSchema = z.object({
  id: z.string().min(1),
  brandId: brandIdSchema,
  title: z.string().min(1),
  platform: schedulePlatformSchema,
  scheduledFor: isoDateTimeSchema,
  caption: z.string().min(1),
  assetNotes: z.string(),
  status: scheduleStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const scheduleCreateRequestSchema = z.object({
  title: z.string().min(1),
  platform: schedulePlatformSchema,
  scheduledFor: isoDateTimeSchema,
  caption: z.string().min(1),
  assetNotes: z.string().default(""),
  status: scheduleStatusSchema.default("planned"),
});

export const scheduleUpdateRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    platform: schedulePlatformSchema.optional(),
    scheduledFor: isoDateTimeSchema.optional(),
    caption: z.string().min(1).optional(),
    assetNotes: z.string().optional(),
    status: scheduleStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type ScheduleCreateRequest = z.infer<typeof scheduleCreateRequestSchema>;
export type ScheduleUpdateRequest = z.infer<typeof scheduleUpdateRequestSchema>;
