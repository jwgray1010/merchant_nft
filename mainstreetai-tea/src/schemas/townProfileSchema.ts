import { z } from "zod";

export const townProfileSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  greetingStyle: z.string().min(1).max(160),
  communityFocus: z.string().min(1).max(200),
  seasonalPriority: z.string().min(1).max(200),
  schoolIntegrationEnabled: z.boolean(),
  sponsorshipStyle: z.string().min(1).max(180),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const townProfileUpsertSchema = z.object({
  greetingStyle: z.string().min(1).max(160).default("warm and neighborly"),
  communityFocus: z.string().min(1).max(200).default("support local families and small businesses"),
  seasonalPriority: z.string().min(1).max(200).default("school events and seasonal community rhythms"),
  schoolIntegrationEnabled: z.boolean().default(true),
  sponsorshipStyle: z.string().min(1).max(180).default("community-first local sponsorship"),
});

export type TownProfile = z.infer<typeof townProfileSchema>;
export type TownProfileUpsert = z.infer<typeof townProfileUpsertSchema>;
