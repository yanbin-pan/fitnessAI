import { sql as rawSql } from "drizzle-orm";
import { companionInteractions } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { COMPANION_INTERACTIONS } from "../shared.ts";
import type { CompanionInteraction } from "../shared.ts";

// How much people interact with their companion (2026-10-08 companions design §8): taps to pet it and opens of its
// bubble, counted per local day, for the owner's dashboard.

/** More than this in a day is a stuck finger or a script; the count stops there. */
export const DAILY_INTERACTION_CAP = 500;

export function recordInteraction(sql: Sql, date: string, kind: CompanionInteraction): void {
  sql
    .insert(companionInteractions)
    .values({ date, kind, count: 1 })
    .onConflictDoUpdate({
      target: [companionInteractions.date, companionInteractions.kind],
      set: { count: rawSql`min(${companionInteractions.count} + 1, ${DAILY_INTERACTION_CAP})` },
    })
    .run();
}

/** Each kind's count over all time, and in each of `months` (YYYY-MM), zeros included. */
export function interactionCounts(sql: Sql, months: readonly string[]) {
  const rows = sql
    .select({ month: rawSql<string>`substr(${companionInteractions.date}, 1, 7)`, kind: companionInteractions.kind, count: rawSql<number>`sum(${companionInteractions.count})` })
    .from(companionInteractions)
    .groupBy(rawSql`1`, companionInteractions.kind)
    .all();
  return COMPANION_INTERACTIONS.map((kind) => {
    const mine = rows.filter((row) => row.kind === kind);
    return {
      kind,
      total: mine.reduce((sum, row) => sum + Number(row.count), 0),
      byMonth: months.map((month) => ({ month, count: Number(mine.find((row) => row.month === month)?.count ?? 0) })),
    };
  });
}
