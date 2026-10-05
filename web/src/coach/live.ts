import { useSyncExternalStore } from "react";

/** The least time a step stays on screen, so one that ends at once is still readable (spec §11.1). */
export const MIN_STEP_MS = 1500;

/** The words under a message the moment it is sent, before the server says anything (spec §11.1). */
export function firstStep(photos: number): string {
  return photos === 0 ? "Thinking…" : photos === 1 ? "Looking at your photo…" : "Looking at your photos…";
}

interface Showing {
  text: string;
  since: number;
  queue: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

// The steps of every message whose stream is open, and the latest step of any whose stream dropped.
const live = new Map<string, Showing>();
const last = new Map<string, string>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

function stopTimer(id: string): void {
  const showing = live.get(id);
  if (showing?.timer) clearTimeout(showing.timer);
}

/** True while a send or a Retry streams this message: its steps arrive on the stream, so the pending poll leaves it be. */
export function isLive(id: string): boolean {
  return live.has(id);
}

/** A stream opens: show its first words at once. */
export function startLive(id: string, first: string): void {
  stopTimer(id);
  last.delete(id);
  live.set(id, { text: first, since: Date.now(), queue: [], timer: null });
  changed();
}

function advance(id: string): void {
  const showing = live.get(id);
  if (!showing || showing.timer !== null || showing.queue.length === 0) return;
  const wait = showing.since + MIN_STEP_MS - Date.now();
  if (wait > 0) {
    showing.timer = setTimeout(() => {
      showing.timer = null;
      advance(id);
    }, wait);
    return;
  }
  showing.text = showing.queue.shift() as string;
  showing.since = Date.now();
  changed();
  advance(id);
}

/** A step arrives: it shows once the one before has had its time. */
export function pushStep(id: string, text: string): void {
  const showing = live.get(id);
  if (!showing) return;
  showing.queue.push(text);
  advance(id);
}

/** The reply arrived: forget the steps. */
export function finishLive(id: string): void {
  stopTimer(id);
  live.delete(id);
  last.delete(id);
  changed();
}

/** The stream dropped before the reply: keep the latest step on screen while the pending poll looks for the reply. */
export function dropLive(id: string): void {
  const showing = live.get(id);
  stopTimer(id);
  live.delete(id);
  if (showing) last.set(id, showing.queue[showing.queue.length - 1] ?? showing.text);
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The step to show under a pending message, when one is known. */
export function useStep(id: string): string | undefined {
  return useSyncExternalStore(subscribe, () => live.get(id)?.text ?? last.get(id));
}

/** Tests only: start from nothing. */
export function resetLive(): void {
  for (const id of live.keys()) stopTimer(id);
  live.clear();
  last.clear();
  changed();
}
