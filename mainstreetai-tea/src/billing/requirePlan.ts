import { FEATURES } from "../config/featureFlags";
import { type BillingPlan } from "../schemas/subscriptionSchema";
import { getEffectivePlanForBrand, hasRequiredPlan } from "./subscriptions";

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

  const effectivePlan = await getEffectivePlanForBrand(userId, brandId);
  if (hasRequiredPlan(effectivePlan, minPlan)) {
    return {
      ok: true,
      plan: effectivePlan,
    };
  }

  return {
    ok: false,
    plan: effectivePlan,
    status: 402,
    body: {
      error: "Upgrade required",
      requiredPlan: minPlan,
      currentPlan: effectivePlan,
    },
  };
}
