import type { EmailProvider, EmailResult, SendEmailInput } from "../Provider";

export type SendgridProviderOptions = {
  apiKey: string;
  fromEmail: string;
  replyToEmail?: string;
};

export class SendgridProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly replyToEmail?: string;

  constructor(options: SendgridProviderOptions) {
    this.apiKey = options.apiKey;
    this.fromEmail = options.fromEmail;
    this.replyToEmail = options.replyToEmail;
  }

  async sendEmail(input: SendEmailInput): Promise<EmailResult> {
    const payload = {
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: this.fromEmail },
      ...(this.replyToEmail ? { reply_to: { email: this.replyToEmail } } : {}),
      subject: input.subject,
      content: [
        ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
        { type: "text/html", value: input.html },
      ],
    };

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`SendGrid email failed (${response.status}): ${rawText}`);
    }

    return {
      providerMessageId: response.headers.get("x-message-id") ?? undefined,
      raw: rawText ? { body: rawText } : { status: "accepted" },
    };
  }
}
