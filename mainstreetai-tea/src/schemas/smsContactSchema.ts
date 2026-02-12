import { z } from "zod";
import { brandIdSchema } from "./brandSchema";

const normalizedPhoneSchema = z
  .string()
  .regex(/^\+1\d{10}$/, "Phone must be normalized US E.164 format (+1XXXXXXXXXX)");

export const smsTagSchema = z.string().min(1).max(64);

export const smsContactSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  brandId: brandIdSchema,
  phone: normalizedPhoneSchema,
  name: z.string().optional(),
  tags: z.array(smsTagSchema).default([]),
  optedIn: z.boolean().default(true),
  consentSource: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const smsContactUpsertSchema = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
  tags: z.array(smsTagSchema).default([]),
  optedIn: z.boolean().default(true),
  consentSource: z.string().optional(),
});

export const smsContactUpdateSchema = z
  .object({
    phone: z.string().min(1).optional(),
    name: z.string().optional(),
    tags: z.array(smsTagSchema).optional(),
    optedIn: z.boolean().optional(),
    consentSource: z.string().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type SmsContact = z.infer<typeof smsContactSchema>;
export type SmsContactUpsert = z.infer<typeof smsContactUpsertSchema>;
export type SmsContactUpdate = z.infer<typeof smsContactUpdateSchema>;
