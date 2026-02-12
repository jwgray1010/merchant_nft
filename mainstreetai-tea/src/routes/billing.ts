import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { actorUserIdFromRequest, resolveBrandAccess } from "../auth/brandAccess";
import { FEATURES } from "../config/featureFlags";
import { getStripeClient } from "../stripe/stripeClient";
import { getAdapter } from "../storage/getAdapter";
import { getSubscriptionForBrand, upsertSubscriptionForBrand } from "../billing/subscriptions";

const router = Router();

const checkoutRequestSchema = z.object({
  brandId: z.string().min(1),
  priceId: z.string().min(1),
});

const cancelRequestSchema = z.object({
  brandId: z.string().min(1),
});

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3001").trim().replace(/\/+$/, "");
}

function subscriptionCurrentPeriodEnd(subscription: Stripe.Subscription): string | undefined {
  const firstItemPeriodEnd = subscription.items.data[0]?.current_period_end;
  if (typeof firstItemPeriodEnd === "number") {
    return new Date(firstItemPeriodEnd * 1000).toISOString();
  }
  return undefined;
}

router.get("/status", async (req, res, next) => {
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId.trim() : "";
  if (!brandId) {
    return res.status(400).json({ error: "Missing brandId query parameter" });
  }
  try {
    const actorUserId = actorUserIdFromRequest(req);
    if (!actorUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const access = await resolveBrandAccess(actorUserId, brandId);
    if (!access) {
      return res.status(404).json({ error: `Brand '${brandId}' was not found` });
    }
    if (access.role !== "owner") {
      return res.status(403).json({ error: "Only owners can view billing status" });
    }
    const subscription = await getSubscriptionForBrand(access.ownerId, access.brandId);
    return res.json({
      role: access.role,
      subscription,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/create-checkout-session", async (req, res, next) => {
  if (!FEATURES.billing) {
    return res.status(404).json({ error: "Billing feature is disabled" });
  }
  const parsedBody = checkoutRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid checkout payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const actorUserId = actorUserIdFromRequest(req);
    if (!actorUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const access = await resolveBrandAccess(actorUserId, parsedBody.data.brandId);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBody.data.brandId}' was not found` });
    }
    if (access.role !== "owner") {
      return res.status(403).json({ error: "Only owners can manage billing" });
    }

    const brand = await getAdapter().getBrand(access.ownerId, access.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${access.brandId}' was not found` });
    }

    const stripe = getStripeClient();
    const existing = await getSubscriptionForBrand(access.ownerId, access.brandId);
    let stripeCustomerId = existing.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.user?.email ?? undefined,
        name: brand.businessName,
        metadata: {
          owner_id: access.ownerId,
          brand_id: access.brandId,
          ...(access.brandRef ? { brand_ref: access.brandRef } : {}),
        },
      });
      stripeCustomerId = customer.id;
    }

    const successUrl = `${appBaseUrl()}/admin/billing?brandId=${encodeURIComponent(
      access.brandId,
    )}&success=true`;
    const cancelUrl = `${appBaseUrl()}/admin/billing?brandId=${encodeURIComponent(
      access.brandId,
    )}&canceled=true`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: parsedBody.data.priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        owner_id: access.ownerId,
        brand_id: access.brandId,
        ...(access.brandRef ? { brand_ref: access.brandRef } : {}),
      },
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          owner_id: access.ownerId,
          brand_id: access.brandId,
          ...(access.brandRef ? { brand_ref: access.brandRef } : {}),
        },
      },
      allow_promotion_codes: true,
    });

    await upsertSubscriptionForBrand(access.ownerId, access.brandId, {
      stripeCustomerId,
      status: "inactive",
      plan: existing.plan,
    });

    return res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/cancel-subscription", async (req, res, next) => {
  if (!FEATURES.billing) {
    return res.status(404).json({ error: "Billing feature is disabled" });
  }
  const parsedBody = cancelRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid cancel payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const actorUserId = actorUserIdFromRequest(req);
    if (!actorUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const access = await resolveBrandAccess(actorUserId, parsedBody.data.brandId);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBody.data.brandId}' was not found` });
    }
    if (access.role !== "owner") {
      return res.status(403).json({ error: "Only owners can cancel subscriptions" });
    }

    const subscription = await getSubscriptionForBrand(access.ownerId, access.brandId);
    if (!subscription.stripeSubscriptionId) {
      return res.status(400).json({ error: "No active Stripe subscription found for this brand" });
    }

    const stripe = getStripeClient();
    const updatedResponse = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    const updated = updatedResponse as unknown as Stripe.Subscription;
    await upsertSubscriptionForBrand(access.ownerId, access.brandId, {
      status: updated.status === "active" ? "active" : "canceled",
      currentPeriodEnd: subscriptionCurrentPeriodEnd(updated),
    });

    return res.json({
      ok: true,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: subscriptionCurrentPeriodEnd(updated) ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
