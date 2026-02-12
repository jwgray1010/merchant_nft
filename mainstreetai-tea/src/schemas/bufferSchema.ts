import { z } from "zod";

export const bufferConnectSchema = z.object({
  accessToken: z.string().min(1),
  channelIdByPlatform: z
    .object({
      facebook: z.string().min(1).optional(),
      instagram: z.string().min(1).optional(),
      tiktok: z.string().min(1).optional(),
      other: z.string().min(1).optional(),
    })
    .partial()
    .optional(),
  defaultChannelId: z.string().min(1).optional(),
  apiBaseUrl: z.string().url().optional(),
});

export type BufferConnectRequest = z.infer<typeof bufferConnectSchema>;
