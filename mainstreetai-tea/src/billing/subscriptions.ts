import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  billingPlanSchema,
  subscriptionRecordSchema,
  subscriptionStatusSchema,
  subscriptionUpsertSchema,
  type BillingPlan,
  type SubscriptionRecord,
  type SubscriptionUpsert,
} from "../schemas/subscriptionSchema";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const PLAN_RANK: Record<BillingPlan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
};

type SubscriptionRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
  brands?: { brand_id?: unknown } | null;
};

function safePlan(value: unknown): BillingPlan {
  const parsed = billingPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : "free";
}

function safeStatus(value: unknown): SubscriptionRecord["status"] {
  const parsed = subscriptionStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "inactive";
}

function defaultSubscription(ownerId: string, brandId: string): SubscriptionRecord {
  const nowIso = new Date().toISOString();
  return subscriptionRecordSchema.parse({
    id: `free-${brandId}`,
    ownerId,
    brandId,
    plan: "free",
    status: "inactive",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

function subscriptionsRoot(): string {
  return path.join(process.cwd(), "data", "local_mode", "subscriptions");
}

function localSubscriptionPath(ownerId: string, brandId: string): string {
  return path.join(subscriptionsRoot(), ownerId, `${brandId}.json`);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(tempPath, JSON.stringify(value, null, 2));
  await rename(tempPath, filePath);
}

async function getLocalSubscription(ownerId: string, brandId: string): Promise<SubscriptionRecord> {
  const filePath = localSubscriptionPath(ownerId, brandId);
  try {
    const raw = await readFile(filePath, "utf8");
    return subscriptionRecordSchema.parse(JSON.parse(raw));
  } catch {
    return defaultSubscription(ownerId, brandId);
  }
}

async function upsertLocalSubscription(
  ownerId: string,
  brandId: string,
  updates: SubscriptionUpsert,
): Promise<SubscriptionRecord> {
  const current = await getLocalSubscription(ownerId, brandId);
  const parsed = subscriptionUpsertSchema.parse(updates);
  const next = subscriptionRecordSchema.parse({
    ...current,
    ...parsed,
    plan: parsed.plan ?? current.plan,
    status: parsed.status ?? current.status,
    updatedAt: new Date().toISOString(),
  });
  await atomicWriteJson(localSubscriptionPath(ownerId, brandId), next);
  return next;
}

async function resolveBrandRef(ownerId: string, brandId: string): Promise<{ id: string; brandId: string } | null> {
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id, brand_id")
    .eq("owner_id", ownerId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row.id !== "string") {
    return null;
  }
  return {
    id: row.id,
    brandId: typeof row.brand_id === "string" ? row.brand_id : brandId,
  };
}

function toSubscriptionRecord(ownerId: string, brandId: string, row: SubscriptionRow): SubscriptionRecord {
  return subscriptionRecordSchema.parse({
    id: row.id,
    ownerId,
    brandId,
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    plan: safePlan(row.plan),
    status: safeStatus(row.status),
    currentPeriodEnd: row.current_period_end ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function hasRequiredPlan(current: BillingPlan, minPlan: BillingPlan): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[minPlan];
}

export async function getSubscriptionForBrand(
  ownerId: string,
  brandId: string,
): Promise<SubscriptionRecord> {
  if (getStorageMode() === "local") {
    // Keep local development frictionless.
    const local = await getLocalSubscription(ownerId, brandId);
    if (local.plan === "free" && local.status === "inactive") {
      return subscriptionRecordSchema.parse({
        ...local,
        plan: "pro",
        status: "active",
      });
    }
    return local;
  }

  const brandRef = await resolveBrandRef(ownerId, brandId);
  if (!brandRef) {
    return defaultSubscription(ownerId, brandId);
  }

  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("subscriptions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("brand_ref", brandRef.id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return defaultSubscription(ownerId, brandId);
  }
  return toSubscriptionRecord(ownerId, brandRef.brandId, data as SubscriptionRow);
}

export async function upsertSubscriptionForBrand(
  ownerId: string,
  brandId: string,
  updates: SubscriptionUpsert,
): Promise<SubscriptionRecord> {
  const parsed = subscriptionUpsertSchema.parse(updates);
  if (getStorageMode() === "local") {
    return upsertLocalSubscription(ownerId, brandId, parsed);
  }

  const brandRef = await resolveBrandRef(ownerId, brandId);
  if (!brandRef) {
    throw new Error(`Brand '${brandId}' was not found`);
  }

  const supabase = getSupabaseAdminClient();
  const payload = {
    owner_id: ownerId,
    brand_ref: brandRef.id,
    stripe_customer_id: parsed.stripeCustomerId ?? null,
    stripe_subscription_id: parsed.stripeSubscriptionId ?? null,
    plan: parsed.plan ?? "free",
    status: parsed.status ?? "inactive",
    current_period_end: parsed.currentPeriodEnd ?? null,
    updated_at: new Date().toISOString(),
  };
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("subscriptions")
    .upsert(payload, { onConflict: "owner_id,brand_ref" })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return toSubscriptionRecord(ownerId, brandRef.brandId, data as SubscriptionRow);
}

export async function updateSubscriptionByStripeId(input: {
  stripeSubscriptionId: string;
  updates: SubscriptionUpsert;
}): Promise<SubscriptionRecord | null> {
  if (getStorageMode() === "local") {
    return null;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data: existing, error: existingError } = await table("subscriptions")
    .select("*, brands!inner(brand_id)")
    .eq("stripe_subscription_id", input.stripeSubscriptionId)
    .maybeSingle();
  if (existingError) {
    throw existingError;
  }
  if (!existing) {
    return null;
  }

  const parsed = subscriptionUpsertSchema.parse(input.updates);
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.stripeCustomerId !== undefined) payload.stripe_customer_id = parsed.stripeCustomerId;
  if (parsed.stripeSubscriptionId !== undefined) payload.stripe_subscription_id = parsed.stripeSubscriptionId;
  if (parsed.plan !== undefined) payload.plan = parsed.plan;
  if (parsed.status !== undefined) payload.status = parsed.status;
  if (parsed.currentPeriodEnd !== undefined) payload.current_period_end = parsed.currentPeriodEnd;

  const { data, error } = await table("subscriptions")
    .update(payload)
    .eq("id", (existing as { id: string }).id)
    .select("*, brands!inner(brand_id)")
    .single();
  if (error) {
    throw error;
  }
  const brands = (data as { brands?: { brand_id?: unknown } }).brands;
  const brandId = typeof brands?.brand_id === "string" ? brands.brand_id : "unknown-brand";
  return toSubscriptionRecord(
    String((data as { owner_id?: unknown }).owner_id ?? ""),
    brandId,
    data as SubscriptionRow,
  );
}

export async function getSubscriptionByStripeId(
  stripeSubscriptionId: string,
): Promise<SubscriptionRecord | null> {
  if (getStorageMode() === "local") {
    return null;
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("subscriptions")
    .select("*, brands!inner(brand_id)")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  const row = data as SubscriptionRow;
  const brands = (data as { brands?: { brand_id?: unknown } }).brands;
  const brandId = typeof brands?.brand_id === "string" ? brands.brand_id : "unknown-brand";
  return toSubscriptionRecord(row.owner_id, brandId, row);
}
