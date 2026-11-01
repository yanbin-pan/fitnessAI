import { asc, eq } from "drizzle-orm";
import { frequentItems } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { listEntriesBetween } from "../log/entries.ts";
import { ExerciseItemInput, FREQUENT_SLOTS, FoodItemInput, REGULARS_WINDOW_DAYS, SLOT_MINUTES, addDays } from "../shared.ts";
import type { FrequentInput, FrequentItem, FrequentSlot, FrequentView, QuickItem, Regular } from "../shared.ts";
import { localTime } from "../time.ts";
import { FREQUENT_KEY_PREFIX, SAME_MEAL, analyseRegulars, itemKeys, jaccard } from "./regulars.ts";
import type { RegularsAnalysis } from "./regulars.ts";

// Frequent items (2026-11-01): meals and activities the person pins, edits and removes, logged with a tap from the chat
// bar's quick button. Regulars found in the log (regulars.ts) are offered beside them until pinned or removed.

/** A pinned item or a regular is "due" while now is within this many minutes of its usual time. */
export const DUE_WITHIN_MIN = 90;

type Row = typeof frequentItems.$inferSelect;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes between two times of day, the short way round midnight. */
function apart(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1440 - d);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** The stored items, read back through the input schemas; anything unreadable is dropped rather than failing the list. */
function itemsOf(row: Row): { foods: FoodItemInput[]; exercises: ExerciseItemInput[] } {
  const foods = FoodItemInput.array().safeParse(row.foods);
  const exercises = ExerciseItemInput.array().safeParse(row.exercises);
  return { foods: foods.success ? foods.data : [], exercises: exercises.success ? exercises.data : [] };
}

const slotOfRow = (row: Row): FrequentSlot => ((FREQUENT_SLOTS as readonly string[]).includes(row.slot) ? (row.slot as FrequentSlot) : "any");

interface Pinned {
  item: FrequentItem;
  /** Minutes after midnight it belongs to: its part of the day's middle, else when it is usually logged; null if never. */
  minutes: number | null;
  keys: Set<string>;
}

function pinnedItems(sql: Sql, today: string, timeZone: string): Pinned[] {
  const rows = sql.select().from(frequentItems).orderBy(asc(frequentItems.created_at), asc(frequentItems.id)).all();
  if (rows.length === 0) return [];
  const logs = listEntriesBetween(sql, addDays(today, 1 - REGULARS_WINDOW_DAYS), today).filter((r) => r.regular_key?.startsWith(FREQUENT_KEY_PREFIX));
  return rows.map((row) => {
    const { foods, exercises } = itemsOf(row);
    const mine = logs.filter((r) => r.regular_key === `${FREQUENT_KEY_PREFIX}${row.id}`);
    const kind = foods.length > 0 ? "meal" : "activity";
    const slot = slotOfRow(row);
    const minutes = slot === "any"
      ? median(mine.map((r) => minutesOf(localTime(new Date(r.entry.logged_at), timeZone))))
      : Math.round((SLOT_MINUTES[slot][0] + SLOT_MINUTES[slot][1]) / 2);
    return {
      item: {
        id: row.id,
        kind,
        name: row.name,
        foods,
        exercises,
        kcal: kind === "meal" ? foods.reduce((sum, f) => sum + f.kcal, 0) : exercises.reduce((sum, x) => sum + (x.kcal ?? 0), 0),
        slot,
        source_key: row.source_key,
        times_logged: mine.length,
        logged_today: mine.some((r) => r.entry.date === today),
      },
      minutes,
      keys: itemKeys(foods, exercises),
    };
  });
}

/** Regulars still worth suggesting: not pinned already, by key or by being much the same items as a pinned one. */
function openSuggestions(analysis: RegularsAnalysis, pinned: Pinned[]): Regular[] {
  const sources = new Set(pinned.map((p) => p.item.source_key).filter(Boolean));
  return analysis.regulars.filter((r) => {
    if (sources.has(r.key)) return false;
    const keys = itemKeys(r.foods, r.exercises);
    return !pinned.some((p) => p.item.kind === r.kind && jaccard(keys, p.keys) >= SAME_MEAL);
  });
}

export function frequentView(sql: Sql, today: string, timeZone: string): FrequentView {
  const pinned = pinnedItems(sql, today, timeZone);
  return { items: pinned.map((p) => p.item), suggestions: openSuggestions(analyseRegulars(sql, today, timeZone), pinned) };
}

/**
 * What the quick button offers at `nowMinutes` (2026-11-01): pinned items, then suggested regulars not logged today;
 * within each, what is due first, then nearest its usual time, then by name. Pinned items logged today stay, last of the
 * pinned, since some things are had twice.
 */
export function quickItems(sql: Sql, today: string, timeZone: string, nowMinutes: number): QuickItem[] {
  const pinned = pinnedItems(sql, today, timeZone);
  const analysis = analyseRegulars(sql, today, timeZone);
  const isDue = (minutes: number | null, slot: FrequentSlot | null, loggedToday: boolean) => {
    if (loggedToday) return false;
    if (slot && slot !== "any") return nowMinutes >= SLOT_MINUTES[slot][0] && nowMinutes < SLOT_MINUTES[slot][1];
    return minutes !== null && apart(minutes, nowMinutes) <= DUE_WITHIN_MIN;
  };
  const rank = (a: { due: boolean; logged: boolean; distance: number; name: string }, b: typeof a) =>
    Number(a.logged) - Number(b.logged) || Number(b.due) - Number(a.due) || a.distance - b.distance || a.name.localeCompare(b.name);

  const mine = pinned
    .map((p) => ({
      quick: {
        ref: `f:${p.item.id}`, kind: p.item.kind, name: p.item.name, kcal: p.item.kcal, activity: p.item.exercises[0]?.activity ?? null,
        pinned: true, due: isDue(p.minutes, p.item.slot, p.item.logged_today), logged_today: p.item.logged_today,
      } satisfies QuickItem,
      distance: p.minutes === null ? 1440 : apart(p.minutes, nowMinutes),
    }))
    .sort((a, b) => rank({ due: a.quick.due, logged: a.quick.logged_today, distance: a.distance, name: a.quick.name }, { due: b.quick.due, logged: b.quick.logged_today, distance: b.distance, name: b.quick.name }));

  const suggested = openSuggestions(analysis, pinned)
    .filter((r) => !r.logged_today)
    .map((r) => {
      const minutes = analysis.minutesByKey.get(r.key) ?? null;
      return {
        quick: {
          ref: `r:${r.key}`, kind: r.kind, name: r.name, kcal: r.kcal, activity: r.exercises[0]?.activity ?? null,
          pinned: false, due: isDue(minutes, null, false), logged_today: false,
        } satisfies QuickItem,
        distance: minutes === null ? 1440 : apart(minutes, nowMinutes),
      };
    })
    .sort((a, b) => rank({ due: a.quick.due, logged: false, distance: a.distance, name: a.quick.name }, { due: b.quick.due, logged: false, distance: b.distance, name: b.quick.name }));

  return [...mine, ...suggested].map((x) => x.quick);
}

export function getFrequent(sql: Sql, today: string, timeZone: string, id: string): FrequentItem | undefined {
  return pinnedItems(sql, today, timeZone).find((p) => p.item.id === id)?.item;
}

/** Makes or replaces a pinned item under the id the phone chose. */
export function saveFrequent(sql: Sql, id: string, input: FrequentInput, nowIso: string): void {
  const values = { name: input.name, foods: input.foods, exercises: input.exercises, slot: input.slot, source_key: input.source_key, updated_at: nowIso };
  sql.insert(frequentItems).values({ id, ...values, created_at: nowIso }).onConflictDoUpdate({ target: frequentItems.id, set: values }).run();
}

/** Unpins an item. What was logged with it stays logged. Returns whether there was one. */
export function deleteFrequent(sql: Sql, id: string): boolean {
  return sql.delete(frequentItems).where(eq(frequentItems.id, id)).run().changes > 0;
}
