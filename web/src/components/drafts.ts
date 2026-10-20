import { useCallback, useSyncExternalStore } from "react";
import type { SetStateAction } from "react";

// What has been typed and attached in a day's composer and not sent yet. It lives here, outside the composer, so moving
// to another day or tab and coming back finds it as it was; a photo still being prepared or uploaded carries on meanwhile.
// It is kept for as long as the page is open.

export interface Draft<A> {
  text: string;
  attachments: A[];
}

// Attachments removed while their photo was still being prepared: don't upload those. Kept with the drafts, since a
// photo picked before a look at another day finishes after the composer that took it has gone.
export const removed = new Set<string>();
// Photos are prepared one at a time, each after the one before has finished: decoding several
// full-size photos at once can use up an iPhone's memory and get the page killed. Uploads may overlap.
export const preparing: { current: Promise<unknown> } = { current: Promise.resolve() };

const drafts = new Map<string, Draft<unknown>>();
const listeners = new Set<() => void>();
const EMPTY: Draft<never> = { text: "", attachments: [] };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current<A>(key: string): Draft<A> {
  return (drafts.get(key) as Draft<A> | undefined) ?? EMPTY;
}

function write<A>(key: string, next: Draft<A>): void {
  if (next.text === "" && next.attachments.length === 0) drafts.delete(key);
  else drafts.set(key, next);
  for (const listener of listeners) listener();
}

const apply = <T>(action: SetStateAction<T>, value: T): T => (typeof action === "function" ? (action as (value: T) => T)(value) : action);

/**
 * The unsent draft under `key` (a day's date), and setters shaped like useState's. An updater runs once, on the draft as
 * it is now, so it may revoke object URLs; it also still lands after the composer has gone.
 */
export function useDraft<A>(key: string) {
  const draft = useSyncExternalStore(subscribe, () => current<A>(key));
  const setText = useCallback((action: SetStateAction<string>) => {
    const was = current<A>(key);
    write(key, { ...was, text: apply(action, was.text) });
  }, [key]);
  const setAttachments = useCallback((action: SetStateAction<A[]>) => {
    const was = current<A>(key);
    write(key, { ...was, attachments: apply(action, was.attachments) });
  }, [key]);
  return { text: draft.text, attachments: draft.attachments, setText, setAttachments };
}

/** Forgets every draft: for tests. */
export function clearDrafts(): void {
  drafts.clear();
  removed.clear();
  preparing.current = Promise.resolve();
  for (const listener of listeners) listener();
}
