import { z } from "zod";
import { MAX_MEMORY_LENGTH, MEMORY_KINDS } from "./vocab.ts";
import type { MemoryKind } from "./vocab.ts";

// What the coach remembers across days (2026-11-02 memories design): short facts it picks up in chat, saved silently and
// listed in Settings, where the person can edit, delete or add them. Health facts are never memories: they belong on the
// Health tab, behind its consent.

/** The most memories kept; the coach is told to update or forget before adding past it. */
export const MAX_MEMORIES = 60;
/** The most the coach is given each day, the newest first. */
export const MEMORIES_IN_PROMPT = 40;

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A memory as written in Settings or by the coach. */
export const MemoryInput = z.object({
  kind: z.enum(MEMORY_KINDS),
  text: z.string().trim().min(1).max(MAX_MEMORY_LENGTH),
  expires_on: IsoDay.nullable().default(null),
});
export type MemoryInput = z.input<typeof MemoryInput>;

export type MemorySource = "coach" | "person";

export interface Memory {
  id: string;
  kind: MemoryKind;
  text: string;
  expires_on: string | null;
  source: MemorySource;
  created_at: string;
  updated_at: string;
}

/** What GET /api/memories returns: the memories still holding, newest first, and whether the coach keeps them. */
export interface MemoriesView {
  enabled: boolean;
  memories: Memory[];
}
