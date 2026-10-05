import { randomUUID } from "node:crypto";
import { eq, sql as rawSql } from "drizzle-orm";
import type { AiUsage } from "../ai/client.ts";
import { aiUsage } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";

/** One coach run that reached Claude, as the daily cap counts it (2.2 §6). */
export interface CoachRun {
  messageId: string;
  /** The person's local date when the run started: the day its calls count against. */
  date: string;
  /** The model that last answered; null when no call came back. */
  model: string | null;
  calls: number;
  usage: AiUsage;
  nowIso: string;
}

export function recordRun(sql: Sql, run: CoachRun): void {
  sql
    .insert(aiUsage)
    .values({
      id: randomUUID(),
      date: run.date,
      message_id: run.messageId,
      model: run.model,
      calls: run.calls,
      input_tokens: run.usage.input_tokens,
      output_tokens: run.usage.output_tokens,
      cache_read_tokens: run.usage.cache_read_input_tokens,
      cache_write_tokens: run.usage.cache_creation_input_tokens,
      created_at: run.nowIso,
    })
    .run();
}

/** Model calls made on a local date: what the daily cap compares with its limit. */
export function callsOn(sql: Sql, date: string): number {
  const row = sql
    .select({ calls: rawSql<number>`coalesce(sum(${aiUsage.calls}), 0)`.mapWith(Number) })
    .from(aiUsage)
    .where(eq(aiUsage.date, date))
    .get();
  return row?.calls ?? 0;
}
