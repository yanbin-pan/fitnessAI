import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { memories } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { MAX_MEMORIES, MEMORIES_IN_PROMPT, MEMORY_KINDS, MemoryInput } from "../shared.ts";
import type { Memory, MemoryKind, MemorySource } from "../shared.ts";

// What the coach remembers across days (2026-11-02 memories design). Deleting really deletes: a forgotten memory is gone.

type Row = typeof memories.$inferSelect;

/** Short, so the coach can name one by id without spending tokens on a UUID. */
export function newMemoryId(): string {
  return randomBytes(4).toString("hex");
}

export const MEMORY_ID = /^[0-9a-f]{8}$/;

function toMemory(row: Row): Memory {
  const kind = (MEMORY_KINDS as readonly string[]).includes(row.kind) ? (row.kind as MemoryKind) : "preference";
  return { id: row.id, kind, text: row.text, expires_on: row.expires_on, source: row.source as MemorySource, created_at: row.created_at, updated_at: row.updated_at };
}

/** The memories still holding on `today`, the most recently changed first. */
export function listMemories(sql: Sql, today: string): Memory[] {
  return sql
    .select()
    .from(memories)
    .orderBy(desc(memories.updated_at), desc(memories.created_at))
    .all()
    .filter((row) => row.expires_on === null || row.expires_on >= today)
    .map(toMemory);
}

export function getMemory(sql: Sql, id: string): Memory | null {
  const row = sql.select().from(memories).where(eq(memories.id, id)).get();
  return row ? toMemory(row) : null;
}

export function countMemories(sql: Sql): number {
  return sql.select({ id: memories.id }).from(memories).all().length;
}

/** Makes or replaces one. A new memory past MAX_MEMORIES drops the stalest first, so the list never grows without end. */
export function saveMemory(
  sql: Sql,
  id: string,
  input: MemoryInput,
  source: MemorySource,
  nowIso: string,
  messageId: string | null = null,
): Memory {
  const value = MemoryInput.parse(input);
  const existing = sql.select().from(memories).where(eq(memories.id, id)).get();
  if (existing) {
    sql.update(memories).set({ ...value, source, updated_at: nowIso }).where(eq(memories.id, id)).run();
  } else {
    sql.insert(memories).values({ id, ...value, source, message_id: messageId, created_at: nowIso, updated_at: nowIso }).run();
    const all = sql.select({ id: memories.id }).from(memories).orderBy(desc(memories.updated_at), desc(memories.created_at)).all();
    for (const stale of all.slice(MAX_MEMORIES)) sql.delete(memories).where(eq(memories.id, stale.id)).run();
  }
  return toMemory(sql.select().from(memories).where(eq(memories.id, id)).get() as Row);
}

export function deleteMemory(sql: Sql, id: string): boolean {
  return sql.delete(memories).where(eq(memories.id, id)).run().changes > 0;
}

export function deleteAllMemories(sql: Sql): void {
  sql.delete(memories).run();
}

/** What the coach is given each day: the newest MEMORIES_IN_PROMPT still holding, compact. */
export function memoriesForCoach(sql: Sql, today: string) {
  return listMemories(sql, today)
    .slice(0, MEMORIES_IN_PROMPT)
    .map((m) => ({ id: m.id, kind: m.kind, text: m.text, ...(m.expires_on ? { until: m.expires_on } : {}), saved: m.updated_at.slice(0, 10) }));
}
