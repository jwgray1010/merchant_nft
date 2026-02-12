import type { GbpPostInput, GbpPostResult, GbpProvider } from "../Provider";

export type GoogleBusinessProviderOptions = {
  accessToken: string;
  locationName: string;
  apiBaseUrl?: string;
};

export class GoogleBusinessProvider implements GbpProvider {
  private readonly accessToken: string;
  private readonly locationName: string;
  private readonly apiBaseUrl: string;

  constructor(options: GoogleBusinessProviderOptions) {
    this.accessToken = options.accessToken;
    this.locationName = options.locationName;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://mybusiness.googleapis.com/v4").replace(
      /\/+$/,
      "",
    );
  }

  async createPost(input: GbpPostInput): Promise<GbpPostResult> {
    const payload: Record<string, unknown> = {
      languageCode: "en-US",
      summary: input.summary,
      topicType: "STANDARD",
    };

    if (input.url) {
      payload.callToAction = {
        actionType: (input.cta ?? "LEARN_MORE").toUpperCase(),
        url: input.url,
      };
    }

    const response = await fetch(
      `${this.apiBaseUrl}/${this.locationName.replace(/^\/+/, "")}/localPosts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // keep text fallback
    }

    if (!response.ok) {
      throw new Error(`Google Business post failed (${response.status}): ${rawText}`);
    }

    const providerPostId =
      typeof parsed === "object" && parsed !== null
        ? String((parsed as Record<string, unknown>).name ?? "")
        : "";

    return {
      providerPostId: providerPostId || undefined,
      raw: parsed,
    };
  }
}
