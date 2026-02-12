import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

export const teamRoleSchema = z.enum(["owner", "admin", "member"]);

export const teamMemberSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  userId: z.string().min(1),
  role: teamRoleSchema.default("member"),
  email: z.string().email().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const teamInviteRequestSchema = z.object({
  email: z.string().email(),
  role: teamRoleSchema.refine((role) => role !== "owner", {
    message: "Owner role cannot be invited",
  }),
});

export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamInviteRequest = z.infer<typeof teamInviteRequestSchema>;
