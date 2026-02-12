import { FEATURES } from "../config/featureFlags";
import { type BillingPlan } from "../schemas/subscriptionSchema";
import { getSubscriptionForBrand, hasRequiredPlan } from "./subscriptions";

export async function requirePlan(
  userId: string,
  brandId: string,
  minPlan: BillingPlan,
): Promise<{ ok: true; plan: BillingPlan } | { ok: false; plan: BillingPlan; status: number; body: unknown }> {
  if (!FEATURES.billing) {
    return {
      ok: true,
      plan: "pro",
    };
  }

  const subscription = await getSubscriptionForBrand(userId, brandId);
  if (hasRequiredPlan(subscription.plan, minPlan)) {
    return {
      ok: true,
      plan: subscription.plan,
    };
  }

  return {
    ok: false,
    plan: subscription.plan,
    status: 402,
    body: {
      error: "Upgrade required",
      requiredPlan: minPlan,
      currentPlan: subscription.plan,
    },
  };
}
