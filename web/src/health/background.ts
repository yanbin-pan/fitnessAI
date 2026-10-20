import { useSyncExternalStore } from "react";
import { api } from "../api.ts";
import type { DocumentReadView } from "../shared.ts";
import { uploadPhotos } from "./common.tsx";

// Work the Health tab started that carries on when the person goes elsewhere: reading a record takes tens of seconds,
// and leaving the tab must not lose it. When it is done away from the tab, the tab bar shows a dot until they come back.

export type ReadState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "ready"; read: DocumentReadView }
  | { status: "failed"; error: unknown };

let read: ReadState = { status: "idle" };
let news = false;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads photos of a record into something to check (design §2), whether or not the tab stays open. Nothing is saved. */
export async function startRead(files: File[]): Promise<void> {
  if (read.status === "reading") return;
  read = { status: "reading" };
  changed();
  try {
    const photo_ids = await uploadPhotos(files);
    read = { status: "ready", read: await api<DocumentReadView>("/api/records/read", { json: { photo_ids } }) };
  } catch (error) {
    read = { status: "failed", error };
  }
  news = true;
  changed();
}

/** The read in hand has been checked, saved or put aside. */
export function clearRead(): void {
  read = { status: "idle" };
  changed();
}

export function useRead(): ReadState {
  return useSyncExternalStore(subscribe, () => read);
}

/** Something on the Health tab finished while the person may have been away: a record read, a reply in its chat. */
export function noteHealthNews(): void {
  news = true;
  changed();
}

/** The person is on the Health tab and has seen it. */
export function seeHealthNews(): void {
  if (!news) return;
  news = false;
  changed();
}

export function useHealthNews(): boolean {
  return useSyncExternalStore(subscribe, () => news);
}

/** Back to how a fresh page starts: for tests. */
export function resetHealthBackground(): void {
  read = { status: "idle" };
  news = false;
  changed();
}
