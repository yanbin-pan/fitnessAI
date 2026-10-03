import { asc, eq, max } from "drizzle-orm";
import type { AiMessage } from "../ai/client.ts";
import { coachThreads, coachTurns } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";

// One thread per day. Its system prompt is frozen at the first message and its
// turns are only ever appended: current Claude models reject a history whose
// earlier turns changed, and an unchanged prefix keeps the prompt cache warm.

export function getOrCreateThread(sql: Sql, date: string, build: () => string, nowIso: string): string {
  const existing = sql.select().from(coachThreads).where(eq(coachThreads.date, date)).get();
  if (existing) return existing.system;
  const system = build();
  sql.insert(coachThreads).values({ date, system, created_at: nowIso }).run();
  return system;
}

export function loadTurns(sql: Sql, date: string): AiMessage[] {
  return sql
    .select()
    .from(coachTurns)
    .where(eq(coachTurns.date, date))
    .orderBy(asc(coachTurns.seq))
    .all()
    .map((row) => ({ role: row.role as AiMessage["role"], content: row.blocks as AiMessage["content"] }));
}

/** Appends one message's turns, all or nothing: a half-written turn would break the day's thread. */
export function appendTurns(sql: Sql, date: string, messageId: string, turns: AiMessage[], nowIso: string): void {
  sql.transaction((tx) => {
    const last = tx.select({ seq: max(coachTurns.seq) }).from(coachTurns).where(eq(coachTurns.date, date)).get();
    let seq = (last?.seq ?? -1) + 1;
    for (const turn of turns) {
      const blocks = typeof turn.content === "string" ? [{ type: "text", text: turn.content }] : turn.content;
      tx.insert(coachTurns).values({ date, seq: seq++, role: turn.role, blocks, message_id: messageId, created_at: nowIso }).run();
    }
  });
}
