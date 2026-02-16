import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BrandProfile } from "../schemas/brandSchema";
import {
  firstWinFeedbackSchema,
  firstWinSessionRowSchema,
  type FirstWinFeedback,
  type FirstWinSessionRow,
} from "../schemas/firstWinSchema";
import { getAdapter, getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";

const LOCAL_ROOT = path.resolve(process.cwd(), "data", "local_mode");

type SupabaseBrandRefRow = {
  id: string;
};

type SupabaseFirstWinSessionRow = {
  id: string;
  brand_ref: string;
  started_at: string;
  completed: boolean;
  result_feedback: string | null;
  created_at: string;
};

export type FirstWinStatus = {
  needsFirstWin: boolean;
  hasCompleted: boolean;
  activeSession: FirstWinSessionRow | null;
  latestCompleted: FirstWinSessionRow | null;
};

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function localUserDir(ownerId: string): string {
  return path.join(LOCAL_ROOT, safePathSegment(ownerId));
}

function localFirstWinSessionsPath(ownerId: string): string {
  return path.join(localUserDir(ownerId), "first_win_sessions.json");
}

function localBrandRef(ownerId: string, brandId: string): string {
  return `${ownerId}:${brandId}`;
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

function toFirstWinSessionRow(row: SupabaseFirstWinSessionRow): FirstWinSessionRow {
  return firstWinSessionRowSchema.parse({
    id: row.id,
    brandRef: row.brand_ref,
    startedAt: row.started_at,
    completed: row.completed,
    resultFeedback: row.result_feedback ?? undefined,
    createdAt: row.created_at,
  });
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

async function listSessionsByBrandRef(input: {
  ownerId: string;
  brandRef: string;
}): Promise<FirstWinSessionRow[]> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("first_win_sessions")
      .select("*")
      .eq("brand_ref", input.brandRef)
      .order("created_at", { ascending: false })
      .limit(32);
    if (error) {
      throw error;
    }
    return ((data ?? []) as SupabaseFirstWinSessionRow[]).map(toFirstWinSessionRow);
  }
  const rows = await readLocalArray(localFirstWinSessionsPath(input.ownerId), firstWinSessionRowSchema);
  return rows
    .filter((row) => row.brandRef === input.brandRef)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function createFirstWinSession(input: {
  ownerId: string;
  brandRef: string;
}): Promise<FirstWinSessionRow> {
  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("first_win_sessions")
      .insert({
        brand_ref: input.brandRef,
      })
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return toFirstWinSessionRow(data as SupabaseFirstWinSessionRow);
  }

  const filePath = localFirstWinSessionsPath(input.ownerId);
  await ensureDir(path.dirname(filePath));
  const existing = await readLocalArray(filePath, firstWinSessionRowSchema);
  const nowIso = new Date().toISOString();
  const next = firstWinSessionRowSchema.parse({
    id: randomUUID(),
    brandRef: input.brandRef,
    startedAt: nowIso,
    completed: false,
    createdAt: nowIso,
  });
  existing.push(next);
  await atomicWriteJson(filePath, existing.slice(-1000));
  return next;
}

function summarizeFirstWinSessions(rows: FirstWinSessionRow[]): {
  hasCompleted: boolean;
  latestCompleted: FirstWinSessionRow | null;
  activeSession: FirstWinSessionRow | null;
} {
  const latestCompleted = rows.find((row) => row.completed) ?? null;
  const activeSession = rows.find((row) => !row.completed) ?? null;
  return {
    hasCompleted: Boolean(latestCompleted),
    latestCompleted,
    activeSession,
  };
}

export async function getFirstWinStatusForBrand(input: {
  ownerId: string;
  brandId: string;
  createIfMissing?: boolean;
}): Promise<FirstWinStatus> {
  const context = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context) {
    return {
      needsFirstWin: false,
      hasCompleted: false,
      activeSession: null,
      latestCompleted: null,
    };
  }

  const existing = await listSessionsByBrandRef({
    ownerId: input.ownerId,
    brandRef: context.brandRef,
  });
  const initial = summarizeFirstWinSessions(existing);
  if (initial.hasCompleted || !input.createIfMissing || initial.activeSession) {
    return {
      needsFirstWin: !initial.hasCompleted,
      hasCompleted: initial.hasCompleted,
      activeSession: initial.activeSession,
      latestCompleted: initial.latestCompleted,
    };
  }

  const activeSession = await createFirstWinSession({
    ownerId: input.ownerId,
    brandRef: context.brandRef,
  });
  return {
    needsFirstWin: true,
    hasCompleted: false,
    activeSession,
    latestCompleted: null,
  };
}

export async function completeFirstWinSessionForBrand(input: {
  ownerId: string;
  brandId: string;
  resultFeedback: FirstWinFeedback;
}): Promise<{
  completed: boolean;
  session: FirstWinSessionRow | null;
}> {
  const feedback = firstWinFeedbackSchema.parse(input.resultFeedback);
  const context = await resolveBrandContext({
    ownerId: input.ownerId,
    brandId: input.brandId,
  });
  if (!context) {
    return { completed: false, session: null };
  }
  const status = await getFirstWinStatusForBrand({
    ownerId: input.ownerId,
    brandId: input.brandId,
    createIfMissing: true,
  });
  const active = status.activeSession;
  if (!active) {
    return { completed: false, session: null };
  }

  if (getStorageMode() === "supabase") {
    const supabase = getSupabaseAdminClient();
    const table = (name: string): any => supabase.from(name as never);
    const { data, error } = await table("first_win_sessions")
      .update({
        completed: true,
        result_feedback: feedback,
      })
      .eq("id", active.id)
      .eq("brand_ref", context.brandRef)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return {
      completed: true,
      session: toFirstWinSessionRow(data as SupabaseFirstWinSessionRow),
    };
  }

  const filePath = localFirstWinSessionsPath(input.ownerId);
  await ensureDir(path.dirname(filePath));
  const rows = await readLocalArray(filePath, firstWinSessionRowSchema);
  const index = rows.findIndex((row) => row.id === active.id && row.brandRef === context.brandRef);
  if (index < 0) {
    return { completed: false, session: null };
  }
  const next = firstWinSessionRowSchema.parse({
    ...rows[index],
    completed: true,
    resultFeedback: feedback,
  });
  rows[index] = next;
  await atomicWriteJson(filePath, rows.slice(-1000));
  return {
    completed: true,
    session: next,
  };
}

export function firstWinCompletionLine(feedback: FirstWinFeedback): string {
  if (feedback === "busy") {
    return "Your first win is underway.";
  }
  if (feedback === "okay") {
    return "Good start. Your first win is in motion.";
  }
  return "First step completed. We'll keep refining for a stronger day.";
}
