import type { OutboxRecord } from "../schemas/outboxSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  getBufferProvider,
  getEmailProvider,
  getGoogleBusinessProvider,
  getTwilioProvider,
} from "./providerFactory";
import { buildDigestPreview } from "../services/digestService";

function mediaTypeFromPayload(payload: Record<string, unknown>): "photo" | "reel" | "story" | "text" {
  if (typeof payload.mediaType === "string") {
    if (payload.mediaType === "photo" || payload.mediaType === "reel" || payload.mediaType === "story" || payload.mediaType === "text") {
      return payload.mediaType;
    }
  }
  return payload.mediaUrl ? "photo" : "text";
}

export async function dispatchOutboxRecord(record: OutboxRecord): Promise<unknown> {
  const adapter = getAdapter();

  if (record.type === "post_publish") {
    const payload = record.payload;
    const platform = String(payload.platform ?? "other") as "facebook" | "instagram" | "tiktok" | "other";
    const caption = String(payload.caption ?? "");
    const mediaUrl = typeof payload.mediaUrl === "string" && payload.mediaUrl.trim() !== "" ? payload.mediaUrl : undefined;
    const linkUrl = typeof payload.linkUrl === "string" && payload.linkUrl.trim() !== "" ? payload.linkUrl : undefined;
    const title = typeof payload.title === "string" && payload.title.trim() !== "" ? payload.title : undefined;
    const bufferProfileId =
      typeof payload.bufferProfileId === "string" && payload.bufferProfileId.trim() !== ""
        ? payload.bufferProfileId
        : typeof payload.profileId === "string" && payload.profileId.trim() !== ""
          ? payload.profileId
          : undefined;
    if (!caption) {
      throw new Error("Outbox post_publish payload missing caption");
    }

    const provider = await getBufferProvider(record.ownerId, record.brandId);
    const result = await provider.publishPost({
      platform,
      caption,
      mediaUrl,
      linkUrl,
      title,
      profileId: bufferProfileId,
    });

    await adapter.addPost(record.ownerId, record.brandId, {
      platform,
      postedAt: new Date().toISOString(),
      mediaType: mediaTypeFromPayload(payload),
      captionUsed: caption,
      promoName:
        typeof payload.promoName === "string" && payload.promoName.trim() !== ""
          ? payload.promoName
          : undefined,
      notes:
        typeof payload.notes === "string" && payload.notes.trim() !== ""
          ? payload.notes
          : `Published via Buffer (outbox: ${record.id})`,
      status: "posted",
      providerMeta: {
        outboxId: record.id,
        bufferProfileId,
        source: typeof payload.source === "string" ? payload.source : undefined,
        providerResult:
          typeof result === "object" && result !== null
            ? result
            : { value: String(result) },
      },
    });

    if (typeof payload.scheduleId === "string" && payload.scheduleId.trim() !== "") {
      await adapter.updateSchedule(record.ownerId, record.brandId, payload.scheduleId, {
        status: "posted",
      });
    }

    await adapter.addHistory(record.ownerId, record.brandId, "publish", payload, result);
    return result;
  }

  if (record.type === "sms_send") {
    const payload = record.payload;
    const to = String(payload.to ?? "").trim();
    const message = String(payload.message ?? "");
    if (!to || !message) {
      throw new Error("Outbox sms_send payload missing to/message");
    }

    const provider = await getTwilioProvider(record.ownerId, record.brandId);
    const result = await provider.sendSms({ to, message });
    await adapter.addHistory(record.ownerId, record.brandId, "sms-send", payload, result);
    return result;
  }

  if (record.type === "gbp_post") {
    const payload = record.payload;
    const summary = String(payload.summary ?? "");
    if (!summary) {
      throw new Error("Outbox gbp_post payload missing summary");
    }

    const provider = await getGoogleBusinessProvider(record.ownerId, record.brandId);
    const result = await provider.createPost({
      locationName:
        typeof payload.locationName === "string" && payload.locationName.trim() !== ""
          ? payload.locationName
          : undefined,
      summary,
      cta:
        typeof payload.cta === "string" && payload.cta.trim() !== ""
          ? payload.cta
          : undefined,
      callToActionUrl:
        typeof payload.callToActionUrl === "string" && payload.callToActionUrl.trim() !== ""
          ? payload.callToActionUrl
          : typeof payload.ctaUrl === "string" && payload.ctaUrl.trim() !== ""
            ? payload.ctaUrl
            : typeof payload.url === "string" && payload.url.trim() !== ""
              ? payload.url
              : undefined,
      mediaUrl:
        typeof payload.mediaUrl === "string" && payload.mediaUrl.trim() !== ""
          ? payload.mediaUrl
          : undefined,
    });
    await adapter.addPost(record.ownerId, record.brandId, {
      platform: "other",
      postedAt: new Date().toISOString(),
      mediaType:
        typeof payload.mediaUrl === "string" && payload.mediaUrl.trim() !== ""
          ? "photo"
          : "text",
      captionUsed: summary,
      notes: `Posted to Google Business (${String(payload.locationName ?? "default location")})`,
      status: "posted",
      providerMeta: {
        outboxId: record.id,
        provider: "google_business",
        locationName: payload.locationName,
        providerResult: result,
      },
    });
    await adapter.addHistory(record.ownerId, record.brandId, "gbp-post", payload, result);
    return result;
  }

  if (record.type === "email_send") {
    const payload = record.payload;
    const to = String(payload.toEmail ?? payload.to ?? "").trim();
    if (!to) {
      throw new Error("Outbox email_send payload missing recipient");
    }

    const template = typeof payload.template === "string" ? payload.template : "";
    let subject = String(payload.subject ?? "").trim();
    let html = String(payload.html ?? "");
    let text =
      typeof payload.textSummary === "string"
        ? payload.textSummary
        : typeof payload.text === "string"
          ? payload.text
          : undefined;
    const emailLogId =
      typeof payload.emailLogId === "string" && payload.emailLogId.trim() !== ""
        ? payload.emailLogId
        : undefined;

    if (template === "digest") {
      const cadence = payload.cadence === "daily" ? "daily" : "weekly";
      const preview = await buildDigestPreview(record.ownerId, record.brandId, {
        cadence,
      });
      subject = preview.subject;
      html = preview.html;
      text = preview.textSummary;
    }

    if (!subject || !html) {
      throw new Error("Outbox email_send payload missing subject/html");
    }

    const provider = await getEmailProvider(record.ownerId, record.brandId);
    const result = await provider.sendEmail({
      to,
      subject,
      html,
      text,
    });
    if (emailLogId) {
      await adapter.updateEmailLog(record.ownerId, record.brandId, emailLogId, {
        status: "sent",
        providerId: result.providerMessageId,
        error: null,
        sentAt: new Date().toISOString(),
      });
    }
    await adapter.addHistory(record.ownerId, record.brandId, "email-digest", payload, result);
    return result;
  }

  throw new Error(`Unsupported outbox type: ${record.type}`);
}
