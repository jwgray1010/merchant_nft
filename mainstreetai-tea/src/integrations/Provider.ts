export type PublishPostInput = {
  platform: "facebook" | "instagram" | "tiktok" | "other";
  caption: string;
  mediaUrl?: string;
  scheduledFor?: string;
};

export type PublishResult = {
  providerMessageId?: string;
  status: "sent" | "queued";
  raw: unknown;
};

export type SendSmsInput = {
  to: string;
  message: string;
};

export type SmsResult = {
  providerMessageId?: string;
  raw: unknown;
};

export type GbpPostInput = {
  summary: string;
  cta?: string;
  url?: string;
};

export type GbpPostResult = {
  providerPostId?: string;
  raw: unknown;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type EmailResult = {
  providerMessageId?: string;
  raw: unknown;
};

export interface SchedulerProvider {
  publishPost(input: PublishPostInput): Promise<PublishResult>;
}

export interface SmsProvider {
  sendSms(input: SendSmsInput): Promise<SmsResult>;
}

export interface GbpProvider {
  createPost(input: GbpPostInput): Promise<GbpPostResult>;
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<EmailResult>;
}
