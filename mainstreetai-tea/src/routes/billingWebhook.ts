import { Router } from "express";
import Stripe from "stripe";
import { getStripeClient } from "../stripe/stripeClient";
import {
  getSubscriptionByStripeId,
  upsertSubscriptionForBrand,
  updateSubscriptionByStripeId,
} from "../billing/subscriptions";

const router = Router();

function webhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
}

function priceIdToPlan(priceId: string | undefined): "free" | "starter" | "pro" {
  const starter = (process.env.STRIPE_PRICE_STARTER ?? "").trim();
  const pro = (process.env.STRIPE_PRICE_PRO ?? "").trim();
  if (priceId && pro && priceId === pro) {
    return "pro";
  }
  if (priceId && starter && priceId === starter) {
    return "starter";
  }
  return "free";
}

function stripeStatusToLocal(status: string | undefined):
  | "inactive"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid" {
  const normalized = (status ?? "").trim();
  if (normalized === "trialing") return "trialing";
  if (normalized === "active") return "active";
  if (normalized === "past_due") return "past_due";
  if (normalized === "canceled") return "canceled";
  if (normalized === "unpaid") return "unpaid";
  return "inactive";
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const ownerId = String(session.metadata?.owner_id ?? "").trim();
  const brandId = String(session.metadata?.brand_id ?? "").trim();
  if (!ownerId || !brandId) {
    return;
  }

  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : undefined;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : undefined;
  let plan: "free" | "starter" | "pro" = "free";
  let status: "inactive" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" =
    "inactive";
  let currentPeriodEnd: string | undefined;

  if (stripeSubscriptionId) {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const firstPriceId = subscription.items.data[0]?.price?.id;
    plan = priceIdToPlan(firstPriceId);
    status = stripeStatusToLocal(subscription.status);
    if (typeof subscription.current_period_end === "number") {
      currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
    }
  }

  await upsertSubscriptionForBrand(ownerId, brandId, {
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    plan,
    currentPeriodEnd,
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const stripeSubscriptionId = subscription.id;
  const firstPriceId = subscription.items.data[0]?.price?.id;
  const updatePayload = {
    stripeCustomerId:
      typeof subscription.customer === "string" ? subscription.customer : undefined,
    stripeSubscriptionId,
    plan: priceIdToPlan(firstPriceId),
    status: stripeStatusToLocal(subscription.status),
    currentPeriodEnd:
      typeof subscription.current_period_end === "number"
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : undefined,
  } as const;

  const existing = await updateSubscriptionByStripeId({
    stripeSubscriptionId,
    updates: updatePayload,
  });
  if (existing) {
    return;
  }

  const ownerId = String(subscription.metadata?.owner_id ?? "").trim();
  const brandId = String(subscription.metadata?.brand_id ?? "").trim();
  if (!ownerId || !brandId) {
    return;
  }
  await upsertSubscriptionForBrand(ownerId, brandId, updatePayload);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const stripeSubscriptionId = subscription.id;
  const existing = await getSubscriptionByStripeId(stripeSubscriptionId);
  if (!existing) {
    return;
  }

  await upsertSubscriptionForBrand(existing.ownerId, existing.brandId, {
    stripeSubscriptionId,
    stripeCustomerId:
      typeof subscription.customer === "string" ? subscription.customer : existing.stripeCustomerId,
    plan: "free",
    status: "canceled",
  });
}

router.post("/", async (req, res, next) => {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || signature.trim() === "") {
    return res.status(400).json({ error: "Missing Stripe signature" });
  }

  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");
    const event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret());

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    if (message.toLowerCase().includes("signature")) {
      return res.status(400).json({ error: "Invalid Stripe webhook signature" });
    }
    return next(error);
  }
});

export default router;
