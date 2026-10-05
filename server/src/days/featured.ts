import { and, asc, count, desc, eq, gte, isNull, lte, max, ne } from "drizzle-orm";
import { entries, exerciseItems } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { ACTIVITIES, addDays } from "../shared.ts";
import type { Activity } from "../shared.ts";

/** The editor features four activities, from the 60 days ending on the viewed day (2.2 §7). */
export const FEATURED_COUNT = 4;
export const FEATURED_DAYS = 60;

/** What fills the row until someone has logged four activities of their own. */
export const OWNER_STARTER: readonly Activity[] = ["tennis", "gym", "wakeboarding", "kitesurfing"];
export const GUEST_STARTER: readonly Activity[] = ["running", "walking", "cycling", "gym"];

export function starterFor(owner: boolean): readonly Activity[] {
  return owner ? OWNER_STARTER : GUEST_STARTER;
}

const KNOWN = new Set<string>(ACTIVITIES);

/**
 * The editor's featured row: the activities with the most exercise items over the 60 days ending on `date`, ties going
 * to the most recently logged, then filled from `starter`, skipping repeats. `other` is never featured: it is no sport,
 * and the picker shows an exercise's own activity anyway.
 */
export function featuredActivities(sql: Sql, date: string, starter: readonly Activity[]): Activity[] {
  const rows = sql
    .select({ activity: exerciseItems.activity })
    .from(exerciseItems)
    .innerJoin(entries, eq(entries.id, exerciseItems.entry_id))
    .where(
      and(
        gte(entries.date, addDays(date, 1 - FEATURED_DAYS)),
        lte(entries.date, date),
        isNull(entries.deleted_at),
        ne(exerciseItems.activity, "other"),
      ),
    )
    .groupBy(exerciseItems.activity)
    .orderBy(desc(count(exerciseItems.id)), desc(max(entries.logged_at)), asc(exerciseItems.activity))
    .all();
  const featured = rows
    .map((row) => row.activity)
    .filter((activity): activity is Activity => KNOWN.has(activity))
    .slice(0, FEATURED_COUNT);
  for (const activity of starter) {
    if (featured.length === FEATURED_COUNT) break;
    if (!featured.includes(activity)) featured.push(activity);
  }
  return featured;
}
