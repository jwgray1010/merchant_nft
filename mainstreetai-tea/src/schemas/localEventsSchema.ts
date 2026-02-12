import { z } from "zod";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "Date must be a valid calendar date",
  });

export const recurringEventInputSchema = z.object({
  eventId: z.string().min(1).optional(),
  name: z.string().min(1),
  pattern: z.string().min(1),
  audience: z.string().min(1),
  notes: z.string().default(""),
});

export const oneOffEventInputSchema = z.object({
  eventId: z.string().min(1).optional(),
  name: z.string().min(1),
  date: isoDateSchema,
  time: z.string().default(""),
  audience: z.string().min(1),
  notes: z.string().default(""),
});

export const recurringEventSchema = recurringEventInputSchema.extend({
  eventId: z.string().min(1),
});

export const oneOffEventSchema = oneOffEventInputSchema.extend({
  eventId: z.string().min(1),
});

export const localEventsSchema = z.object({
  recurring: z.array(recurringEventSchema).default([]),
  oneOff: z.array(oneOffEventSchema).default([]),
});

export const localEventsUpsertSchema = z.object({
  mode: z.enum(["replace", "append"]).default("replace"),
  recurring: z.array(recurringEventInputSchema).optional(),
  oneOff: z.array(oneOffEventInputSchema).optional(),
});

export type RecurringEvent = z.infer<typeof recurringEventSchema>;
export type OneOffEvent = z.infer<typeof oneOffEventSchema>;
export type LocalEvents = z.infer<typeof localEventsSchema>;
export type LocalEventsUpsert = z.infer<typeof localEventsUpsertSchema>;
