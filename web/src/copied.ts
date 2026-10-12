import { useSyncExternalStore } from "react";
import { MAX_COPIES } from "./shared.ts";
import type { Entry } from "./shared.ts";

// Entries copied to paste onto another day, without the coach: each entry card's copy button adds its entry. Kept in the
// browser, like a clipboard: it holds only which entries were copied (the server duplicates them, nutrition and all) and
// their names, to say what a paste adds.

export interface CopiedEntry {
  id: string;
  /** What the entry holds, as its card names it. */
  names: string;
}

export interface Copied {
  entries: CopiedEntry[];
}

const STORAGE_KEY = "copied-entries";
const listeners = new Set<() => void>();

function isCopied(value: unknown): value is Copied {
  const v = value as Copied | null;
  return (
    Array.isArray(v?.entries) &&
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

/** Adds the entry to what is copied, or takes it out again if it is already there. */
export function toggleCopied(entry: Entry): void {
  const entries = current?.entries ?? [];
  const next = entries.some((e) => e.id === entry.id)
    ? entries.filter((e) => e.id !== entry.id)
    : [...entries, { id: entry.id, names: entryNames(entry) }].slice(-MAX_COPIES);
  set(next.length > 0 ? { entries: next } : null);
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
