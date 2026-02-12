import type { StorageAdapter } from "./StorageAdapter";
import { LocalAdapter } from "./local/LocalAdapter";
import { SupabaseAdapter } from "./supabase/SupabaseAdapter";

let adapterInstance: StorageAdapter | null = null;

function resolveMode(): "local" | "supabase" {
  const mode = (process.env.STORAGE_MODE ?? "local").trim().toLowerCase();
  return mode === "supabase" ? "supabase" : "local";
}

export function getAdapter(): StorageAdapter {
  if (adapterInstance) {
    return adapterInstance;
  }

  const mode = resolveMode();
  adapterInstance = mode === "supabase" ? new SupabaseAdapter() : new LocalAdapter();
  return adapterInstance;
}

export function getStorageMode(): "local" | "supabase" {
  return resolveMode();
}
