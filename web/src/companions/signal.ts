import { useSyncExternalStore } from "react";

// "The companion has something for you" (2026-10-23 pet tips design): any part of the app can raise a signal, and the
// companion glows while one is up. A tap on the glowing companion opens the most important signal instead of its window.
// Tips are the first to use it; a weekly insight that is ready, or a record that has been read, could be next.

export interface PetSignal {
  /** Unique per signal: raising one with the same key replaces it. */
  key: string;
  /** Higher first. */
  priority: number;
  /** Read out with the companion's name, such as "has a tip for you". */
  label: string;
  /** What a tap does. The signal stays up until its owner clears it. */
  open: () => void;
}

const signals = new Map<string, PetSignal>();
const listeners = new Set<() => void>();
let top: PetSignal | null = null;

function changed(): void {
  top = null;
  for (const signal of signals.values()) if (!top || signal.priority > top.priority) top = signal;
  for (const listener of listeners) listener();
}

export function raisePetSignal(signal: PetSignal): void {
  signals.set(signal.key, signal);
  changed();
}

export function clearPetSignal(key: string): void {
  if (signals.delete(key)) changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The signal a tap on the companion opens, or null when it has nothing for you. */
export function usePetSignal(): PetSignal | null {
  return useSyncExternalStore(subscribe, () => top);
}

/** Clears every signal: for tests. */
export function clearPetSignals(): void {
  signals.clear();
  changed();
}
