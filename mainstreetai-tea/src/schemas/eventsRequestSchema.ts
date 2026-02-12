import { z } from "zod";

export const singleEventSchema = z.object({
  name: z.string().min(1),
  time: z.string().min(1),
  audience: z.string().min(1),
});

export const eventsRequestSchema = z.object({
  events: z.array(singleEventSchema).min(1),
  notes: z.string().optional(),
});

export const eventsOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      event: z.string(),
      promoIdea: z.string(),
      caption: z.string(),
      simpleOffer: z.string(),
    }),
  ),
});

export type EventsRequest = z.infer<typeof eventsRequestSchema>;
export type EventsOutput = z.infer<typeof eventsOutputSchema>;
