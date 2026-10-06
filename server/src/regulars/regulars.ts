import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { regularOverrides } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import {
  ExerciseItemInput, FoodItemInput, REGULARS_MIN_DATA_DAYS, REGULARS_WINDOW_DAYS, REGULAR_MIN_DAYS_SEEN, addDays,
} from "../shared.ts";
import type { Entry, ExerciseItem, FoodItem, Regular, RegularEdit, RegularKind, RegularsView } from "../shared.ts";
import { listEntriesBetween } from "../log/entries.ts";
import { localTime } from "../time.ts";

// Regulars (2026-10-06 design §2) are worked out from the entries on every read, never stored: what someone logs is
// the only source, so they come and go with the habit. Only the person's edits and removals are kept, by key.

/** How alike two entries' items must be to count as the same meal (Jaccard over the item keys). */
export const SAME_MEAL = 0.6;
/** Suggestions are regulars usually logged within this many minutes of now, on either side. */
export const SUGGEST_WITHIN_MIN = 240;
export const MAX_SUGGESTIONS = 3;

/** An item's name as compared: lowercase, without numbers, punctuation or doubled spaces ("2 Fried eggs!" → "fried eggs"). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\p{N}+/gu, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What an item counts as. An exercise is its sport (a tennis match is tennis, singles or doubles), unless it has none. */
function itemKey(item: FoodItem | ExerciseItem, food: boolean): string {
  if (food) return `f:${normalizeName(item.name)}`;
  const activity = (item as ExerciseItem).activity;
  return activity === "other" ? `x:other:${normalizeName(item.name)}` : `x:${activity}`;
}

export function regularKey(signature: string): string {
  return createHash("sha256").update(signature).digest("hex").slice(0, 16);
}

interface Occurrence {
  entry: Entry;
  tapped: string | null;
  kind: RegularKind;
  keys: Set<string>;
  signature: string;
  minutes: number;
}

interface Cluster {
  kind: RegularKind;
  seed: Set<string>;
  members: Occurrence[];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const key of a) if (b.has(key)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function toFoodInput(f: FoodItem): FoodItemInput {
  return {
    name: f.name, quantity: f.quantity, grams: f.grams, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
    fibre_g: f.fibre_g, saturated_fat_g: f.saturated_fat_g, sugars_g: f.sugars_g, salt_g: f.salt_g, fluid_ml: f.fluid_ml,
    alcohol_units: f.alcohol_units, assumption: f.assumption, groups: f.groups,
  };
}

function toExerciseInput(x: ExerciseItem): ExerciseItemInput {
  return {
    name: x.name, category: x.category, activity: x.activity, duration_min: x.duration_min, sets: x.sets, reps: x.reps,
    weight_kg: x.weight_kg, distance_km: x.distance_km, avg_hr: null, met: x.met, kcal: x.kcal, assumption: x.assumption,
    muscles: x.muscles,
  };
}

type Override = typeof regularOverrides.$inferSelect;

/** The stored items of an edit, read back through the same schemas as any input; anything unreadable is ignored. */
function overrideItems(override: Override | undefined): { foods: FoodItemInput[]; exercises: ExerciseItemInput[] } | null {
  if (!override || override.foods === null || override.exercises === null) return null;
  const foods = FoodItemInput.array().safeParse(override.foods);
  const exercises = ExerciseItemInput.array().safeParse(override.exercises);
  return foods.success && exercises.success ? { foods: foods.data, exercises: exercises.data } : null;
}

/** "Porridge, Coffee and 2 more" style names, from the items a tap would log. */
function nameFrom(items: { name: string }[]): string {
  const names = [...new Set(items.map((item) => item.name.trim()).filter(Boolean))];
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export interface RegularsAnalysis extends RegularsView {
  /** Minutes after local midnight each regular is usually logged at, by key. */
  minutesByKey: Map<string, number>;
}

/**
 * The person's regulars as of `today` (2026-10-06 design §2.1): over the four weeks ending today, entries of the same
 * kind whose items are at least 60 % alike are one pattern, and a pattern seen on three different days is a regular.
 * Nothing is found before five days have something logged. A removed regular stays away; an edited one keeps its edits.
 */
export function analyseRegulars(sql: Sql, today: string, timeZone: string): RegularsAnalysis {
  const from = addDays(today, 1 - REGULARS_WINDOW_DAYS);
  const rows = listEntriesBetween(sql, from, today);
  const dataDays = new Set(rows.map((row) => row.entry.date)).size;
  const view: RegularsAnalysis = {
    data_days: dataDays, required_days: REGULARS_MIN_DATA_DAYS, window_days: REGULARS_WINDOW_DAYS, regulars: [], minutesByKey: new Map(),
  };
  if (dataDays < REGULARS_MIN_DATA_DAYS) return view;

  const overrides = new Map(sql.select().from(regularOverrides).all().map((row) => [row.key, row]));
  const occurrences: Occurrence[] = rows
    .filter(({ entry }) => entry.foods.length + entry.exercises.length > 0)
    .map(({ entry, regular_key }) => {
      const keys = new Set([...entry.foods.map((f) => itemKey(f, true)), ...entry.exercises.map((x) => itemKey(x, false))]);
      const [h, m] = localTime(new Date(entry.logged_at), timeZone).split(":").map(Number);
      return {
        entry,
        tapped: regular_key,
        kind: entry.foods.length > 0 ? "meal" : "activity",
        keys,
        signature: [...keys].sort().join("|"),
        minutes: h * 60 + m,
      };
    });

  // Entries typed or photographed: grouped by how alike their items are, each joining the closest pattern so far.
  const clusters: Cluster[] = [];
  for (const occurrence of occurrences.filter((o) => o.tapped === null)) {
    let best: Cluster | null = null;
    let bestScore = SAME_MEAL;
    for (const cluster of clusters) {
      if (cluster.kind !== occurrence.kind) continue;
      const score = jaccard(occurrence.keys, cluster.seed);
      if (score >= bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best) best.members.push(occurrence);
    else clusters.push({ kind: occurrence.kind, seed: occurrence.keys, members: [occurrence] });
  }

  // A pattern's key is its usual set of items: the one seen on the most days, unless the person has edited one of them.
  const keyed = new Map<string, { cluster: Cluster; signature: string }>();
  for (const cluster of clusters) {
    const daysBySignature = new Map<string, Set<string>>();
    for (const member of cluster.members) {
      const days = daysBySignature.get(member.signature) ?? new Set<string>();
      days.add(member.entry.date);
      daysBySignature.set(member.signature, days);
    }
    const ranked = [...daysBySignature].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
    const signature = ranked.find(([candidate]) => overrides.has(regularKey(candidate)))?.[0] ?? ranked[0][0];
    keyed.set(regularKey(signature), { cluster, signature });
  }
  // Entries logged with a tap count towards their regular, whatever their items have become since.
  for (const occurrence of occurrences.filter((o) => o.tapped !== null)) {
    const key = occurrence.tapped as string;
    const found = keyed.get(key);
    if (found) found.cluster.members.push(occurrence);
    else keyed.set(key, { cluster: { kind: occurrence.kind, seed: occurrence.keys, members: [occurrence] }, signature: occurrence.signature });
  }

  for (const [key, { cluster, signature }] of keyed) {
    const override = overrides.get(key);
    if (override?.dismissed) continue;
    const days = new Set(cluster.members.map((m) => m.entry.date));
    if (days.size < REGULAR_MIN_DAYS_SEEN) continue;
    // What a tap logs: the person's edit, else the latest time it was had as usual (so portions follow the habit).
    const latest = [...cluster.members].reverse().find((m) => m.signature === signature) ?? cluster.members[cluster.members.length - 1];
    const edited = overrideItems(override);
    const foods = edited?.foods ?? latest.entry.foods.map(toFoodInput);
    const exercises = edited?.exercises ?? latest.entry.exercises.map(toExerciseInput);
    const kind: RegularKind = foods.length > 0 ? "meal" : "activity";
    const minutes = median(cluster.members.map((m) => m.minutes));
    view.minutesByKey.set(key, minutes);
    view.regulars.push({
      key,
      kind,
      name: override?.name ?? nameFrom([...foods, ...exercises]),
      foods,
      exercises,
      kcal: kind === "meal" ? foods.reduce((sum, f) => sum + f.kcal, 0) : exercises.reduce((sum, x) => sum + (x.kcal ?? 0), 0),
      typical_time: hhmm(minutes),
      days_seen: days.size,
      last_seen: [...days].sort().at(-1) as string,
      edited: override !== undefined && (override.name !== null || edited !== null),
      logged_today: days.has(today),
    });
  }
  view.regulars.sort((a, b) => a.kind.localeCompare(b.kind) || a.typical_time.localeCompare(b.typical_time) || a.name.localeCompare(b.name));
  return view;
}

/** The regulars to offer now (2026-10-06 design §2.2): not yet logged today, usually logged within four hours of now, nearest first. */
export function suggestRegulars(analysis: RegularsAnalysis, nowMinutes: number): Regular[] {
  const distance = (key: string) => {
    const d = Math.abs((analysis.minutesByKey.get(key) ?? 0) - nowMinutes);
    return Math.min(d, 1440 - d);
  };
  return analysis.regulars
    .filter((r) => !r.logged_today && distance(r.key) <= SUGGEST_WITHIN_MIN)
    .sort((a, b) => distance(a.key) - distance(b.key))
    .slice(0, MAX_SUGGESTIONS);
}

export function saveRegularEdit(sql: Sql, key: string, edit: RegularEdit, nowIso: string): void {
  const values = { name: edit.name, foods: edit.foods, exercises: edit.exercises, dismissed: false, updated_at: nowIso };
  sql.insert(regularOverrides).values({ key, ...values }).onConflictDoUpdate({ target: regularOverrides.key, set: values }).run();
}

/** Removes a regular: it stops being suggested and listed, and the same pattern is never offered again. */
export function dismissRegular(sql: Sql, key: string, nowIso: string): void {
  const values = { name: null, foods: null, exercises: null, dismissed: true, updated_at: nowIso };
  sql.insert(regularOverrides).values({ key, ...values }).onConflictDoUpdate({ target: regularOverrides.key, set: values }).run();
}

export function hasOverride(sql: Sql, key: string): boolean {
  return sql.select({ key: regularOverrides.key }).from(regularOverrides).where(eq(regularOverrides.key, key)).get() !== undefined;
}
