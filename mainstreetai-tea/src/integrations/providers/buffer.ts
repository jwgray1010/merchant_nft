import type { PublishPostInput, PublishResult, SchedulerProvider } from "../Provider";

type BufferPlatform = PublishPostInput["platform"];

export type BufferProviderOptions = {
  accessToken: string;
  channelIdByPlatform?: Partial<Record<BufferPlatform, string>>;
  defaultChannelId?: string;
  apiBaseUrl?: string;
};

export class BufferProvider implements SchedulerProvider {
  private readonly accessToken: string;
  private readonly channelIdByPlatform: Partial<Record<BufferPlatform, string>>;
  private readonly defaultChannelId?: string;
  private readonly apiBaseUrl: string;

  constructor(options: BufferProviderOptions) {
    this.accessToken = options.accessToken;
    this.channelIdByPlatform = options.channelIdByPlatform ?? {};
    this.defaultChannelId = options.defaultChannelId;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.bufferapp.com/1").replace(/\/+$/, "");
  }

  private resolveChannelId(platform: BufferPlatform): string {
    const mapped = this.channelIdByPlatform[platform] ?? this.defaultChannelId;
    if (!mapped || mapped.trim() === "") {
      throw new Error(`No Buffer channel configured for platform '${platform}'`);
    }
    return mapped.trim();
  }

  async publishPost(input: PublishPostInput): Promise<PublishResult> {
    const channelId = this.resolveChannelId(input.platform);
    const params = new URLSearchParams();
    params.set("access_token", this.accessToken);
    params.set("text", input.caption);
    params.append("profile_ids[]", channelId);
    params.set("now", input.scheduledFor ? "false" : "true");
    if (input.scheduledFor) {
      params.set("scheduled_at", new Date(input.scheduledFor).toISOString());
    }
    if (input.mediaUrl) {
      params.set("media[photo]", input.mediaUrl);
    }

    const response = await fetch(`${this.apiBaseUrl}/updates/create.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // keep text fallback
    }

    if (!response.ok) {
      throw new Error(`Buffer publish failed (${response.status}): ${rawText}`);
    }

    const parsedRecord =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const update = parsedRecord["updates"];
    const providerMessageId =
      Array.isArray(update) && update.length > 0 && typeof update[0] === "object" && update[0] !== null
        ? String((update[0] as Record<string, unknown>).id ?? "")
        : undefined;

    return {
      providerMessageId: providerMessageId && providerMessageId !== "" ? providerMessageId : undefined,
      status: input.scheduledFor ? "queued" : "sent",
      raw: parsed,
    };
  }
}
