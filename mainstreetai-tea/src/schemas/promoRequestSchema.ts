import { z } from "zod";

export const promoRequestSchema = z.object({
  dateLabel: z.string().min(1),
  weather: z.enum(["cold", "hot", "rainy", "windy", "nice"]),
  slowHours: z.string().min(1).optional(),
  inventoryNotes: z.string().optional(),
  goal: z.enum(["new_customers", "repeat_customers", "slow_hours"]),
});

export const promoOutputSchema = z.object({
  promoName: z.string(),
  offer: z.string(),
  when: z.string(),
  whoItsFor: z.string(),
  inStoreSign: z.string(),
  socialCaption: z.string(),
  smsText: z.string(),
  staffNotes: z.string(),
  upsellSuggestion: z.string(),
});

export type PromoRequest = z.infer<typeof promoRequestSchema>;
export type PromoOutput = z.infer<typeof promoOutputSchema>;
