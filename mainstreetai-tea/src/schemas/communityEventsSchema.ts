import { z } from "zod";

export const communityEventSourceSchema = z.enum([
  "chamber",
  "school",
  "youth",
  "nonprofit",
]);

export const communityEventNeedSchema = z.enum([
  "catering",
  "sponsorship",
  "drinks",
  "volunteers",
]);

export const eventInterestTypeSchema = z.enum([
  "cater",
  "sponsor",
  "assist",
]);

export const communityEventRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  source: communityEventSourceSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  eventDate: z.string().datetime({ offset: true }),
  needs: z.array(communityEventNeedSchema).default([]),
  signupUrl: z.string().url().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const eventInterestRowSchema = z.object({
  id: z.string().min(1),
  brandRef: z.string().min(1),
  eventRef: z.string().min(1),
  interestType: eventInterestTypeSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const communityEventImportItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  eventDate: z.string().min(1),
  needs: z.array(communityEventNeedSchema).optional(),
  signupUrl: z.string().url().optional(),
});

export const communityEventsImportRequestSchema = z
  .object({
    townId: z.string().min(1),
    source: communityEventSourceSchema.default("chamber"),
    icsUrl: z.string().url().optional(),
    websiteUrl: z.string().url().optional(),
    websiteText: z.string().min(1).optional(),
    googleWebhook: z.unknown().optional(),
    events: z.array(communityEventImportItemSchema).optional(),
    defaultSignupUrl: z.string().url().optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.icsUrl ||
          value.websiteUrl ||
          value.websiteText ||
          value.googleWebhook ||
          (value.events && value.events.length > 0),
      ),
    {
      message: "Provide at least one import source (icsUrl, websiteUrl/text, googleWebhook, or events).",
      path: ["icsUrl"],
    },
  );

export const communityEventFormSubmitSchema = z.object({
  townId: z.string().min(1),
  source: communityEventSourceSchema.default("chamber"),
  eventName: z.string().min(1),
  date: z.string().min(1),
  helpNeeded: z.string().min(1),
  contactInfo: z.string().min(1),
  description: z.string().optional(),
  signupUrl: z.string().url().optional(),
});

export const communityOpportunitySchema = z.object({
  eventId: z.string().min(1),
  source: communityEventSourceSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  eventDate: z.string().datetime({ offset: true }),
  needs: z.array(communityEventNeedSchema).default([]),
  line: z.string().min(1),
  suggestedInterestType: eventInterestTypeSchema,
  suggestedMessage: z.string().min(1).optional(),
  signupUrl: z.string().url().optional(),
});

export const eventInterestCreateRequestSchema = z.object({
  eventId: z.string().min(1),
  interestType: eventInterestTypeSchema.optional(),
});

export const eventResponseOutputSchema = z.object({
  message: z.string().min(1),
});

export type CommunityEventSource = z.infer<typeof communityEventSourceSchema>;
export type CommunityEventNeed = z.infer<typeof communityEventNeedSchema>;
export type EventInterestType = z.infer<typeof eventInterestTypeSchema>;
export type CommunityEventRow = z.infer<typeof communityEventRowSchema>;
export type EventInterestRow = z.infer<typeof eventInterestRowSchema>;
export type CommunityEventsImportRequest = z.infer<typeof communityEventsImportRequestSchema>;
export type CommunityEventFormSubmit = z.infer<typeof communityEventFormSubmitSchema>;
export type CommunityOpportunity = z.infer<typeof communityOpportunitySchema>;
