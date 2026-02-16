import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runPrompt } from "../ai/runPrompt";
import { calcConfidence } from "../confidence/calcConfidence";
import type { BrandProfile } from "../schemas/brandSchema";
import {
  ownerConfidencePromptOutputSchema,
  ownerProgressRowSchema,
  ownerWinMomentRowSchema,
  type OwnerConfidenceSummary,
  type OwnerProgressActionType,
  type OwnerProgressRow,
  type OwnerWinMomentRow,
} from "../schemas/ownerConfidenceSchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseBrandRefRow = {
  id: string;
};

type SupabaseOwnerProgressRow = {
  id: string;
  owner_id: string;
  brand_ref: string;
  action_date: string;
  action_type: string;
  created_at: string;
};

type SupabaseOwnerWinMomentRow = {
  id: string;
  owner_id: string;
  message: string;
  created_at: string;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(ownerId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(ownerId));
}

function localOwnerProgressPath(ownerId: string): string {
  return path.join(localUserDir(ownerId), "owner_progress.json");
}

function localOwnerWinMomentsPath(ownerId: string): string {
  return path.join(localUserDir(ownerId), "owner_win_moments.json");
}

function localBrandRef(ownerId: string, brandId: string): string {
  return `${ownerId}:${brandId}`;
}

function isoDateFrom(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function todayDate(): string {
  return isoDateFrom(new Date());
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function readLocalArray<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const parsed = z.array(schema).safeParse(await readJsonOrNull<unknown>(filePath));
  if (parsed.success) {
    return parsed.data;
  }
  return [];
}

function toOwnerProgressRow(row: SupabaseOwnerProgressRow): OwnerProgressRow {
  return ownerProgressRowSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    brandRef: row.brand_ref,
    actionDate: row.action_date,
    actionType: row.action_type,
    createdAt: row.created_at,
  });
}

function toOwnerWinMomentRow(row: SupabaseOwnerWinMomentRow): OwnerWinMomentRow {
  return ownerWinMomentRowSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    message: row.message,
    createdAt: row.created_at,
  });
}

function parseCheckinOutcome(salesNotes: string | undefined): "slow" | "okay" | "busy" | null {
  const notes = (salesNotes ?? "").trim();
  if (!notes) {
    return null;
  }
  const match = notes.match(/daily_checkin:[^:]+:(slow|okay|busy)/i);
  if (!match) {
    return null;
  }
  const value = String(match[1] ?? "").toLowerCase();
  if (value === "slow" || value === "okay" || value === "busy") {
    return value;
  }
  return null;
}

function msDaysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

const CONFIDENCE_LEVEL_RANK: Record<"low" | "steady" | "rising", number> = {
  low: 0,
  steady: 1,
  rising: 2,
};

function minimumHint(level: "low" | "steady" | "rising"): string {
  if (level === "rising") {
    return "You are building momentum through steady follow-through.";
  }
  if (level === "steady") {
    return "Steady effort matters more than perfect days.";
  }
  return "A small action today can restart momentum.";
}

function applyMinimumConfidenceLevel(
  summary: OwnerConfidenceSummary,
  minimumLevel: "low" | "steady" | "rising" | undefined,
): OwnerConfidenceSummary {
  if (!minimumLevel) {
    return summary;
  }
  if (CONFIDENCE_LEVEL_RANK[summary.confidenceLevel] >= CONFIDENCE_LEVEL_RANK[minimumLevel]) {
    return summary;
  }
  return {
    ...summary,
    confidenceLevel: minimumLevel,
    momentumHint: minimumHint(minimumLevel),
  };
}

async function resolveBrandContext(input: {
  ownerId: string;
  brandId: string;
}): Promise<{ brandRef: string; brand: BrandProfile } | null> {
  const brand = await getAdapter().getBrand(input.ownerId, input.brandId);
  if (!brand) {
    return null;
  }
  if (getStorageMode() !== "supabase") {
    return {
      brandRef: localBrandRef(input.ownerId, input.brandId),
      brand,
    };
  }
  const supabase = getSupabaseAdminClient();
  const table = (name: string): any => supabase.from(name as never);
  const { data, error } = await table("brands")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("brand_id", input.brandId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const row = (data as SupabaseBrandRefRow | null) ?? null;
  if (!row?.id) {
    return null;
  }
  return {
    brandRef: row.id,
    brand,
  };
}

async function listOwnerProgressRows(input: {
  ownerId: string;
  brandRef?: string;
  sinceDate?: string;
}): Promise<OwnerProgressRow[]> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    let query = table("owner_progress")
      .select("*")
      .eq("owner_id", input.ownerId)
      .order("action_date", { ascending: false })
      .limit(4000);
    if (input.brandRef) {
      query = query.eq("brand_ref", input.brandRef);
    }
    if (input.sinceDate) {
      query = query.gte("action_date", input.sinceDate);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseOwnerProgressRow[]).map(toOwnerProgressRow);
  }

  const rows = await readLocalArray(localOwnerProgressPath(input.ownerId), ownerProgressRowSchema);
  return rows
    .filter((row) => (!input.brandRef || row.brandRef === input.brandRef) && (!input.sinceDate || row.actionDate >= input.sinceDate))
    .sort((a, b) => b.actionDate.localeCompare(a.actionDate));
}

async function createWinMomentIfNeeded(input: {
  ownerId: string;
  message: string;
  dedupeWindowDays?: number;
}): Promise<OwnerWinMomentRow | null> {
  const dedupeDays = Math.max(1, Math.min(120, input.dedupeWindowDays ?? 21));
  const cutoffIso = new Date(msDaysAgo(dedupeDays)).toISOString();

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data: existing, error: existingError } = await table("owner_win_moments")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("message", input.message)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }
    if (existing) {
      return toOwnerWinMomentRow(existing as SupabaseOwnerWinMomentRow);
    }
    const { data, error } = await table("owner_win_moments")
      .insert({
        owner_id: input.ownerId,
        message: input.message,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toOwnerWinMomentRow(data as SupabaseOwnerWinMomentRow);
  }

  const filePath = localOwnerWinMomentsPath(input.ownerId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray(filePath, ownerWinMomentRowSchema);
  const cutoffMs = msDaysAgo(dedupeDays);
  const hasRecentDuplicate = existing.some((entry) => {
    if (entry.message !== input.message) {
      return false;
    }
    const createdMs = new Date(entry.createdAt).getTime();
    return Number.isFinite(createdMs) && createdMs >= cutoffMs;
  });
  if (hasRecentDuplicate) {
    return null;
  }
  const next = ownerWinMomentRowSchema.parse({
    id: randomUUID(),
    ownerId: input.ownerId,
    message: input.message,
    createdAt: new Date().toISOString(),
  });
  existing.push(next);
  await atomicWriteJson(filePath, existing.slice(-2000));
  return next;
}

async function maybeRecordStreakWinMoment(input: {
  ownerId: string;
  confidence: OwnerConfidenceSummary;
}): Promise<void> {
  if (input.confidence.streakDays < 7) {
    return;
  }
  await createWinMomentIfNeeded({
    ownerId: input.ownerId,
    message: "Looks like your consistency is turning into real momentum.",
    dedupeWindowDays: 28,
  }).catch(() => null);
}

export async function recordOwnerProgressAction(input: {
  ownerId: string;
  brandId: string;
  actionType: OwnerProgressActionType;
  actionDate?: string;
}): Promise<OwnerProgressRow | null> {
  const context = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context) {
    return null;
  }
  const actionDate = input.actionDate ?? todayDate();

  let row: OwnerProgressRow;
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("owner_progress")
      .upsert(
        {
          owner_id: input.ownerId,
          brand_ref: context.brandRef,
          action_date: actionDate,
          action_type: input.actionType,
        },
        { onConflict: "owner_id,action_date,action_type" },
      )
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    row = toOwnerProgressRow(data as SupabaseOwnerProgressRow);
  } else {
    const filePath = localOwnerProgressPath(input.ownerId);
    await ensureDir(path.dirname(filePath));
    const rows = await readLocalArray(filePath, ownerProgressRowSchema);
    const index = rows.findIndex(
      (entry) =>
        entry.ownerId === input.ownerId &&
        entry.actionDate === actionDate &&
        entry.actionType === input.actionType,
    );
    const next = ownerProgressRowSchema.parse({
      id: index >= 0 ? rows[index].id : randomUUID(),
      ownerId: input.ownerId,
      brandRef: context.brandRef,
      actionDate,
      actionType: input.actionType,
      createdAt: index >= 0 ? rows[index].createdAt : new Date().toISOString(),
    });
    if (index >= 0) {
      rows[index] = next;
    } else {
      rows.push(next);
    }
    await atomicWriteJson(filePath, rows.slice(-16000));
    row = next;
  }

  const confidence = await getOwnerConfidenceForBrand({
    ownerId: input.ownerId,
    brandId: input.brandId,
    includePromptLine: false,
  }).catch(() => null);
  if (confidence) {
    await maybeRecordStreakWinMoment({
      ownerId: input.ownerId,
      confidence,
    });
  }
  return row;
}

export async function maybeRecordOutcomeWinMoments(input: {
  ownerId: string;
  brandId: string;
  outcome: "slow" | "okay" | "busy";
  actionDate?: string;
}): Promise<void> {
  const actionDate = input.actionDate ?? todayDate();
  const context = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context) {
    return;
  }

  const weekCutoff = isoDateFrom(new Date(msDaysAgo(7)));
  const progress = await listOwnerProgressRows({
    ownerId: input.ownerId,
    sinceDate: weekCutoff,
  }).catch(() => []);
  const hadRescueToday = progress.some(
    (entry) => entry.actionDate === actionDate && entry.actionType === "rescue_used",
  );

  const metrics = await getAdapter().listMetrics(input.ownerId, input.brandId, 600).catch(() => []);
  const recentBusyCount = metrics
    .filter((entry) => new Date(entry.createdAt).getTime() >= msDaysAgo(7))
    .map((entry) => parseCheckinOutcome(entry.salesNotes))
    .filter((entry): entry is "busy" | "okay" | "slow" => entry !== null)
    .filter((entry) => entry === "busy").length;

  if (input.outcome === "busy" && recentBusyCount >= 2) {
    await createWinMomentIfNeeded({
      ownerId: input.ownerId,
      message: "Looks like more days are ending busy. Your consistency is paying off.",
      dedupeWindowDays: 21,
    }).catch(() => null);
  }

  if ((input.outcome === "busy" || input.outcome === "okay") && hadRescueToday) {
    await createWinMomentIfNeeded({
      ownerId: input.ownerId,
      message: "Your quick rescue adjustment helped today. Nice work staying flexible.",
      dedupeWindowDays: 14,
    }).catch(() => null);
  }
}

export async function listOwnerWinMoments(input: {
  ownerId: string;
  limit?: number;
}): Promise<OwnerWinMomentRow[]> {
  const max = Math.max(1, Math.min(50, input.limit ?? 8));
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("owner_win_moments")
      .select("*")
      .eq("owner_id", input.ownerId)
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseOwnerWinMomentRow[]).map(toOwnerWinMomentRow);
  }
  const rows = await readLocalArray(localOwnerWinMomentsPath(input.ownerId), ownerWinMomentRowSchema);
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

export async function recordOwnerWinMoment(input: {
  ownerId: string;
  message: string;
  dedupeWindowDays?: number;
}): Promise<void> {
  const message = input.message.trim();
  if (!message) {
    return;
  }
  await createWinMomentIfNeeded({
    ownerId: input.ownerId,
    message,
    dedupeWindowDays: input.dedupeWindowDays,
  }).catch(() => null);
}

export async function getOwnerConfidenceForBrand(input: {
  ownerId: string;
  brandId: string;
  includePromptLine?: boolean;
  minimumLevel?: "low" | "steady" | "rising";
}): Promise<
  OwnerConfidenceSummary & {
    line: string;
  }
> {
  const includePromptLine = Boolean(input.includePromptLine);
  const context = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context) {
    const fallback = applyMinimumConfidenceLevel(
      calcConfidence({
        last7ActionDates: [],
        last30ActionDates: [],
        checkinOutcomesLast30: [],
        rescueActionsLast30: 0,
      }),
      input.minimumLevel,
    );
    return {
      ...fallback,
      line: fallback.momentumHint,
    };
  }

  const cutoff30 = isoDateFrom(new Date(msDaysAgo(30)));
  const cutoff7 = isoDateFrom(new Date(msDaysAgo(7)));
  const progressRows = await listOwnerProgressRows({
    ownerId: input.ownerId,
    sinceDate: cutoff30,
  });
  const last30ActionDates = progressRows.map((row) => row.actionDate);
  const last7ActionDates = progressRows
    .filter((row) => row.actionDate >= cutoff7)
    .map((row) => row.actionDate);
  const rescueActionsLast30 = progressRows.filter((row) => row.actionType === "rescue_used").length;

  const metrics = await getAdapter().listMetrics(input.ownerId, input.brandId, 800).catch(() => []);
  const checkinOutcomesLast30 = metrics
    .filter((entry) => new Date(entry.createdAt).getTime() >= msDaysAgo(30))
    .map((entry) => parseCheckinOutcome(entry.salesNotes))
    .filter((entry): entry is "slow" | "okay" | "busy" => entry !== null);

  const summary = calcConfidence({
    last7ActionDates,
    last30ActionDates,
    checkinOutcomesLast30,
    rescueActionsLast30,
  });
  const adjustedSummary = applyMinimumConfidenceLevel(summary, input.minimumLevel);

  if (!includePromptLine) {
    return {
      ...adjustedSummary,
      line: adjustedSummary.momentumHint,
    };
  }

  const promptLine = await runPrompt({
    promptFile: "owner_confidence.md",
    brandProfile: context.brand,
    userId: input.ownerId,
    input: {
      confidenceLevel: adjustedSummary.confidenceLevel,
      streakDays: adjustedSummary.streakDays,
      recentTrend: adjustedSummary.recentTrend,
    },
    outputSchema: ownerConfidencePromptOutputSchema,
  })
    .then((result) => result.confidenceLine)
    .catch(() => adjustedSummary.momentumHint);

  return {
    ...adjustedSummary,
    line: promptLine,
  };
}
