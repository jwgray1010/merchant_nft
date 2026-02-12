import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { FEATURES } from "../config/featureFlags";
import { brandIdSchema } from "../schemas/brandSchema";
import { processDueOutbox } from "../jobs/outboxProcessor";
import { smsCampaignRequestSchema } from "../schemas/smsCampaignSchema";
import {
  smsContactUpdateSchema,
  smsContactUpsertSchema,
} from "../schemas/smsContactSchema";
import { smsSendRequestSchema } from "../schemas/smsSendSchema";
import { getAdapter } from "../storage/getAdapter";
import { getTwilioProvider } from "../integrations/providerFactory";
import { normalizeUSPhone } from "../utils/phone";
import { getLocationById } from "../services/locationStore";

const router = Router();

router.use((_req, res, next) => {
  if (!FEATURES.sms) {
    return res.status(404).json({ error: "SMS feature is disabled" });
  }
  return next();
});

function parseLimit(value: unknown, defaultValue: number): number {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, 1000);
}

function getBrandId(raw: unknown) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const parsed = brandIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function isElevatedRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

router.get("/contacts", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/sms/contacts?brandId=main-street-nutrition",
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }

    const contacts = await adapter.listSmsContacts(userId, brandId, parseLimit(req.query.limit, 100));
    return res.json(contacts);
  } catch (error) {
    return next(error);
  }
});

router.post("/contacts", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/sms/contacts?brandId=main-street-nutrition",
    });
  }

  const parsedBody = smsContactUpsertSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid SMS contact payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }

    const contact = await adapter.upsertSmsContact(userId, brandId, {
      ...parsedBody.data,
      phone: normalizeUSPhone(parsedBody.data.phone),
    });
    return res.status(201).json(contact);
  } catch (error) {
    return next(error);
  }
});

router.put("/contacts/:contactId", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/sms/contacts/:contactId?brandId=main-street-nutrition",
    });
  }

  const contactId = req.params.contactId?.trim();
  if (!contactId) {
    return res.status(400).json({ error: "Missing contactId route parameter" });
  }

  const parsedBody = smsContactUpdateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid SMS contact update payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }

    const updated = await adapter.updateSmsContact(userId, brandId, contactId, parsedBody.data);
    if (!updated) {
      return res.status(404).json({ error: `SMS contact '${contactId}' was not found` });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete("/contacts/:contactId", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /api/sms/contacts/:contactId?brandId=main-street-nutrition",
    });
  }

  const contactId = req.params.contactId?.trim();
  if (!contactId) {
    return res.status(400).json({ error: "Missing contactId route parameter" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }
    const deleted = await adapter.deleteSmsContact(userId, brandId, contactId);
    if (!deleted) {
      return res.status(404).json({ error: `SMS contact '${contactId}' was not found` });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/send", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error: "Missing or invalid brandId query parameter. Example: /sms/send?brandId=main-street-nutrition",
    });
  }

  const parsedBody = smsSendRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid SMS payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole;
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    const planCheck = await requirePlan(userId, brandId, "pro");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim() !== ""
        ? req.query.locationId.trim()
        : null;
    const location = locationId ? await getLocationById(userId, brandId, locationId) : null;
    if (locationId && !location) {
      return res.status(404).json({ error: `Location '${locationId}' was not found` });
    }

    await getTwilioProvider(userId, brandId);

    const normalizedTo = normalizeUSPhone(parsedBody.data.to);
    const existingContacts = await adapter.listSmsContacts(userId, brandId, 5000);
    const existingContact = existingContacts.find((contact) => contact.phone === normalizedTo);
    if (existingContact && !existingContact.optedIn) {
      return res.status(400).json({
        error: "Recipient is currently opted out and cannot be messaged",
        contactId: existingContact.id,
      });
    }

    const message = await adapter.addSmsMessage(userId, brandId, {
      toPhone: normalizedTo,
      body: parsedBody.data.message,
      status: "queued",
      purpose: parsedBody.data.purpose,
    });

    const outbox = await adapter.enqueueOutbox(
      userId,
      brandId,
      "sms_send",
      {
        to: normalizedTo,
        body: parsedBody.data.message,
        purpose: parsedBody.data.purpose,
        smsMessageId: message.id,
        locationId: location?.id,
        locationName: location?.name,
      },
      new Date().toISOString(),
    );

    if (parsedBody.data.sendNow) {
      await processDueOutbox({ limit: 25, types: ["sms_send"] });
      const refreshedMessages = await adapter.listSmsMessages(userId, brandId, 200);
      const updatedMessage = refreshedMessages.find((entry) => entry.id === message.id);
      return res.status(202).json({
        queued: true,
        outboxId: outbox.id,
        messageId: message.id,
        status: updatedMessage?.status ?? "queued",
      });
    }

    return res.status(202).json({
      queued: true,
      outboxId: outbox.id,
      messageId: message.id,
      warning: "Only send SMS to recipients who explicitly opted in.",
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/campaign", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error:
        "Missing or invalid brandId query parameter. Example: /sms/campaign?brandId=main-street-nutrition",
    });
  }

  const parsedBody = smsCampaignRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid SMS campaign payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole;
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    const planCheck = await requirePlan(userId, brandId, "pro");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim() !== ""
        ? req.query.locationId.trim()
        : null;
    const location = locationId ? await getLocationById(userId, brandId, locationId) : null;
    if (locationId && !location) {
      return res.status(404).json({ error: `Location '${locationId}' was not found` });
    }

    await getTwilioProvider(userId, brandId);
    const contacts = await adapter.listSmsContacts(userId, brandId, 5000);
    const normalizedTag = parsedBody.data.listTag.trim().toLowerCase();
    const selected = contacts.filter((contact) => {
      if (!contact.optedIn) {
        return false;
      }
      if (normalizedTag === "general") {
        return true;
      }
      return contact.tags.some((tag) => tag.trim().toLowerCase() === normalizedTag);
    });

    if (parsedBody.data.dryRun) {
      return res.json({
        dryRun: true,
        listTag: parsedBody.data.listTag,
        recipientCount: selected.length,
        recipientsPreview: selected.slice(0, 20).map((contact) => ({
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          tags: contact.tags,
        })),
        warning: "SMS should only be sent to opted-in recipients.",
      });
    }

    const smsMessages = await Promise.all(
      selected.map((contact) =>
        adapter.addSmsMessage(userId, brandId, {
          toPhone: contact.phone,
          body: parsedBody.data.message,
          status: "queued",
          purpose: "promo",
        }),
      ),
    );

    const outbox = await adapter.enqueueOutbox(
      userId,
      brandId,
      "sms_campaign",
      {
        listTag: parsedBody.data.listTag,
        body: parsedBody.data.message,
        locationId: location?.id,
        locationName: location?.name,
        recipients: smsMessages.map((message) => ({
          to: message.toPhone,
          smsMessageId: message.id,
        })),
      },
      new Date().toISOString(),
    );

    if (parsedBody.data.sendNow) {
      await processDueOutbox({ limit: 25, types: ["sms_campaign"] });
    }

    return res.status(202).json({
      status: "queued",
      listTag: parsedBody.data.listTag,
      recipientCount: smsMessages.length,
      outboxId: outbox.id,
      warning: "Only send to recipients that explicitly opted in.",
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/log", async (req, res, next) => {
  const brandId = getBrandId(req.query.brandId);
  if (!brandId) {
    return res.status(400).json({
      error: "Missing or invalid brandId query parameter. Example: /api/sms/log?brandId=main-street-nutrition",
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }

    const logs = await adapter.listSmsMessages(userId, brandId, parseLimit(req.query.limit, 100));
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
});

export default router;
