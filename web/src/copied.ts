import { useSyncExternalStore } from "react";
import type { Entry } from "./shared.ts";

// Entries copied to paste onto another day, without the coach. Kept in the browser, like a clipboard: it holds only
// which entries were copied (the server duplicates them, nutrition and all) and their names, to say what a paste adds.

export interface CopiedEntry {
  id: string;
  /** What the entry holds, as its card names it. */
  names: string;
}

export interface Copied {
  /** The day they were copied from. */
  from: string;
  entries: CopiedEntry[];
}

const STORAGE_KEY = "copied-entries";
const listeners = new Set<() => void>();

function isCopied(value: unknown): value is Copied {
  const v = value as Copied | null;
  return (
    typeof v?.from === "string" &&
    Array.isArray(v.entries) &&
    v.entries.length > 0 &&
    v.entries.every((e) => typeof e?.id === "string" && typeof e?.names === "string")
  );
}

function read(): Copied | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return isCopied(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let current: Copied | null = read();

function set(next: Copied | null): void {
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing: it holds for this visit.
  }
  for (const listener of listeners) listener();
}

export const entryNames = (entry: Entry) => [...entry.foods.map((f) => f.name), ...entry.exercises.map((x) => x.name)].join(", ");

/** Copies these entries of `from`, replacing whatever was copied before. */
export function copyEntries(from: string, entries: readonly Entry[]): void {
  set(entries.length > 0 ? { from, entries: entries.map((entry) => ({ id: entry.id, names: entryNames(entry) })) } : null);
}

export function clearCopied(): void {
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Copied in another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** What is copied, or null. */
export function useCopied(): Copied | null {
  return useSyncExternalStore(subscribe, () => current);
}
