import type { SendSmsInput, SmsProvider, SmsResult } from "../Provider";

export type TwilioProviderOptions = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export class TwilioProvider implements SmsProvider {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor(options: TwilioProviderOptions) {
    this.accountSid = options.accountSid;
    this.authToken = options.authToken;
    this.fromNumber = options.fromNumber;
  }

  async sendSms(input: SendSmsInput): Promise<SmsResult> {
    const params = new URLSearchParams();
    params.set("To", input.to);
    params.set("From", this.fromNumber);
    params.set("Body", input.message);

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );

    const rawText = await response.text();
    let parsed: unknown = rawText;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // keep text
    }

    if (!response.ok) {
      throw new Error(`Twilio SMS failed (${response.status}): ${rawText}`);
    }

    const providerMessageId =
      typeof parsed === "object" && parsed !== null
        ? String((parsed as Record<string, unknown>).sid ?? "")
        : "";

    return {
      providerMessageId: providerMessageId || undefined,
      raw: parsed,
    };
  }
}
