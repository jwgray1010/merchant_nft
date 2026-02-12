import { FEATURES } from "../config/featureFlags";
import { type BillingPlan } from "../schemas/subscriptionSchema";
import { getEffectivePlanForBrand, hasRequiredPlan } from "./subscriptions";
import { getCommunitySupportStatusForBrand } from "../services/communityImpactService";
import { getTownAmbassadorForBrand } from "../services/townAdoptionService";

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

  const sponsorship =
    minPlan === "pro"
      ? null
      : await getCommunitySupportStatusForBrand({
          ownerId: userId,
          brandId,
          autoAssign: true,
        }).catch(() => null);
  const ambassador =
    minPlan === "pro"
      ? null
      : await getTownAmbassadorForBrand({
          ownerId: userId,
          brandId,
        }).catch(() => null);
  if (ambassador && minPlan !== "pro") {
    return {
      ok: true,
      plan: effectivePlan === "pro" ? "pro" : "starter",
    };
  }
  if (sponsorship?.sponsored && minPlan !== "pro") {
    return {
      ok: true,
      plan: effectivePlan === "pro" ? "pro" : "starter",
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
      sponsorship: sponsorship
        ? {
            supportLevel: sponsorship.supportLevel,
            eligibleForSponsorship: sponsorship.eligibleForSponsorship,
            activeSponsoredMembership: sponsorship.sponsored,
            seatsRemaining: sponsorship.seatsRemaining,
            reducedCostUpgradePath: sponsorship.reducedCostUpgradePath,
          }
        : undefined,
      ambassador: ambassador
        ? {
            active: true,
            role: ambassador.ambassador.role,
          }
        : undefined,
    },
  };
}
