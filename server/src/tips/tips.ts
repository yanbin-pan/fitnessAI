import { asc, eq } from "drizzle-orm";
import { tipsSeen } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { TIP_IDS } from "../shared.ts";
import type { SeenTip, TipId, TipVars } from "../shared.ts";

// The companion's tips that have been shown (2026-10-23 pet tips design). The phone picks the tip and its moment; the
// server keeps the list, so a tip never comes back on another phone, and holds the daily limit.

/** Every tip shown so far, oldest first. A tip since dropped from the app is left out. */
export function seenTips(sql: Sql): SeenTip[] {
  return sql
    .select()
    .from(tipsSeen)
    .orderBy(asc(tipsSeen.seen_at))
    .all()
    .filter((row) => (TIP_IDS as readonly string[]).includes(row.id))
    .map((row) => ({ id: row.id as TipId, date: row.date, seen_at: row.seen_at, vars: row.vars as TipVars }));
}

/**
 * Keeps a tip as shown on `date`. Already shown: nothing changes, so a repeated request is harmless. Returns false when
 * the day already has `limit` tips.
 */
export function markTipSeen(sql: Sql, tip: { id: TipId; vars: TipVars }, date: string, nowIso: string, limit: number): boolean {
  if (sql.select({ id: tipsSeen.id }).from(tipsSeen).where(eq(tipsSeen.id, tip.id)).get()) return true;
  if (sql.select({ id: tipsSeen.id }).from(tipsSeen).where(eq(tipsSeen.date, date)).all().length >= limit) return false;
  sql.insert(tipsSeen).values({ id: tip.id, date, seen_at: nowIso, vars: tip.vars }).run();
  return true;
}
