import { z } from "zod";
import { communityEventNeedSchema } from "./communityEventsSchema";

export const townBoardSourceSchema = z.enum([
  "chamber",
  "school",
  "youth",
  "nonprofit",
  "organizer",
]);

export const townBoardStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);

export const townBoardPostSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  source: townBoardSourceSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  eventDate: z.string().datetime({ offset: true }),
  needs: z.array(communityEventNeedSchema).default([]),
  contactInfo: z.string().min(1),
  signupUrl: z.string().url().optional(),
  status: townBoardStatusSchema.default("pending"),
  createdAt: z.string().datetime({ offset: true }),
});

export const townBoardSubmissionSchema = z.object({
  source: townBoardSourceSchema.default("organizer"),
  eventName: z.string().min(1),
  date: z.string().min(1),
  needs: z.array(communityEventNeedSchema).default([]),
  description: z.string().optional(),
  contactInfo: z.string().min(1),
  signupUrl: z.string().url().optional(),
});

export const townBoardModerationSchema = z
  .object({
    status: townBoardStatusSchema.optional(),
    source: townBoardSourceSchema.optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    date: z.string().min(1).optional(),
    needs: z.array(communityEventNeedSchema).optional(),
    contactInfo: z.string().min(1).optional(),
    signupUrl: z.string().url().optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.status ||
          value.source ||
          value.title ||
          value.description !== undefined ||
          value.date ||
          value.needs ||
          value.contactInfo ||
          value.signupUrl,
      ),
    {
      message: "At least one moderation field is required",
      path: ["status"],
    },
  );

export const townBoardCleanOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  communityLine: z.string().min(1),
});

export type TownBoardSource = z.infer<typeof townBoardSourceSchema>;
export type TownBoardStatus = z.infer<typeof townBoardStatusSchema>;
export type TownBoardPost = z.infer<typeof townBoardPostSchema>;
export type TownBoardSubmission = z.infer<typeof townBoardSubmissionSchema>;
export type TownBoardModeration = z.infer<typeof townBoardModerationSchema>;
