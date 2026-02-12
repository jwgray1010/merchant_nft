import { z } from "zod";

export const communitySponsorRoleSchema = z.enum([
  "chamber",
  "bank",
  "downtown_org",
  "nonprofit",
]);

export const communitySponsorRowSchema = z.object({
  id: z.string().min(1),
  townRef: z.string().min(1),
  sponsorName: z.string().min(1),
  role: communitySponsorRoleSchema.default("nonprofit"),
  sponsoredSeats: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  createdAt: z.string().datetime({ offset: true }),
});

export const communitySponsorUpsertSchema = z.object({
  sponsorName: z.string().min(1),
  role: communitySponsorRoleSchema.default("nonprofit"),
  sponsoredSeats: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export const sponsoredMembershipStatusSchema = z.enum(["active", "paused", "ended"]);

export const sponsoredMembershipRowSchema = z.object({
  id: z.string().min(1),
  sponsorRef: z.string().min(1),
  brandRef: z.string().min(1),
  status: sponsoredMembershipStatusSchema.default("active"),
  createdAt: z.string().datetime({ offset: true }),
});

export const townPulseEnergySchema = z.enum(["low", "medium", "high"]);

export const communityImpactSummarySchema = z.object({
  activeBusinesses: z.number().int().min(0),
  townPulseEnergy: townPulseEnergySchema,
  topCategories: z.array(z.string().min(1)).max(3),
  sponsorship: z.object({
    activeSponsors: z.number().int().min(0),
    totalSeats: z.number().int().min(0),
    activeSponsoredBusinesses: z.number().int().min(0),
    seatsRemaining: z.number().int().min(0),
    strugglingBusinesses: z.number().int().min(0),
    waitlistNeeded: z.boolean(),
  }),
});

export type CommunitySponsorRow = z.infer<typeof communitySponsorRowSchema>;
export type CommunitySponsorUpsert = z.infer<typeof communitySponsorUpsertSchema>;
export type SponsoredMembershipRow = z.infer<typeof sponsoredMembershipRowSchema>;
export type SponsoredMembershipStatus = z.infer<typeof sponsoredMembershipStatusSchema>;
export type CommunityImpactSummary = z.infer<typeof communityImpactSummarySchema>;
export type CommunitySponsorRole = z.infer<typeof communitySponsorRoleSchema>;
