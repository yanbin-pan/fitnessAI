import { and, asc, eq, inArray, isNull, sql as rawSql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { entries, exerciseItems, exerciseMuscles, foodItemGroups, foodItems } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { FOOD_GROUPS, MUSCLES } from "../shared.ts";
import type {
  Entry, EntrySource, ExerciseCategory, ExerciseItem, FoodGroup, FoodItem, Muscle, MuscleRole,
} from "../shared.ts";

export interface FoodItemData {
  name: string;
  quantity: string;
  grams: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  saturated_fat_g: number;
  sugars_g: number;
  salt_g: number;
  fluid_ml: number;
  alcohol_units: number;
  assumption: string;
  saved_food_id: string | null;
  groups: { group: FoodGroup; portions: number }[];
}

export interface ExerciseItemData {
  name: string;
  category: ExerciseCategory;
  duration_min: number | null;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  distance_km: number | null;
  avg_hr: number | null;
  met: number | null;
  kcal: number;
  kcal_measured: boolean;
  assumption: string;
  muscles: { muscle: Muscle; role: MuscleRole }[];
}

export interface NewEntry {
  id: string;
  date: string;
  logged_at: string;
  source: EntrySource;
  message_id: string | null;
  foods: FoodItemData[];
  exercises: ExerciseItemData[];
}

/** One row per food group: repeats are summed and empty portions dropped. */
export function normalizeGroups(groups: FoodItemData["groups"]): FoodItemData["groups"] {
  const totals = new Map<FoodGroup, number>();
  for (const g of groups) totals.set(g.group, (totals.get(g.group) ?? 0) + g.portions);
  return [...totals].filter(([, portions]) => portions > 0).map(([group, portions]) => ({ group, portions }));
}

/** One row per muscle; if a muscle is listed twice, primary wins. */
export function normalizeMuscles(muscles: ExerciseItemData["muscles"]): ExerciseItemData["muscles"] {
  const roles = new Map<Muscle, MuscleRole>();
  for (const m of muscles) if (roles.get(m.muscle) !== "primary") roles.set(m.muscle, m.role);
  return [...roles].map(([muscle, role]) => ({ muscle, role }));
}

function insertItems(sql: Sql, entryId: string, foods: FoodItemData[], exercises: ExerciseItemData[]): void {
  foods.forEach(({ groups, ...food }, position) => {
    const id = randomUUID();
    sql.insert(foodItems).values({ ...food, id, entry_id: entryId, position }).run();
    for (const g of normalizeGroups(groups)) {
      sql.insert(foodItemGroups).values({ food_item_id: id, food_group: g.group, portions: g.portions }).run();
    }
  });
  exercises.forEach(({ muscles, ...exercise }, position) => {
    const id = randomUUID();
    sql.insert(exerciseItems).values({ ...exercise, id, entry_id: entryId, position }).run();
    for (const m of normalizeMuscles(muscles)) {
      sql.insert(exerciseMuscles).values({ exercise_item_id: id, muscle: m.muscle, role: m.role }).run();
    }
  });
}

/** Inserts an entry with its items, all or nothing (a savepoint inside a caller's transaction). */
export function insertEntry(sql: Sql, entry: NewEntry, nowIso: string): void {
  const { foods, exercises, ...columns } = entry;
  sql.transaction((tx) => {
    tx.insert(entries).values({ ...columns, edited: false, created_at: nowIso, updated_at: nowIso }).run();
    insertItems(tx, entry.id, foods, exercises);
  });
}

/** Swaps all of a live entry's items for new ones and marks it edited, all or nothing. */
export function replaceEntryItems(
  sql: Sql, entryId: string, foods: FoodItemData[], exercises: ExerciseItemData[], nowIso: string,
): boolean {
  return sql.transaction((tx) => {
    const existing = tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, entryId), isNull(entries.deleted_at)))
      .get();
    if (!existing) return false;
    tx.delete(foodItems).where(eq(foodItems.entry_id, entryId)).run();
    tx.delete(exerciseItems).where(eq(exerciseItems.entry_id, entryId)).run();
    insertItems(tx, entryId, foods, exercises);
    tx.update(entries).set({ edited: true, updated_at: nowIso }).where(eq(entries.id, entryId)).run();
    return true;
  });
}

/**
 * Items, groups and muscles go with it (ON DELETE CASCADE). From milestone 3,
 * apple_health entries must be tombstoned (deleted_at) instead (spec §5, §12).
 */
export function deleteEntry(sql: Sql, entryId: string): boolean {
  return sql.delete(entries).where(eq(entries.id, entryId)).run().changes > 0;
}

export function getEntry(sql: Sql, id: string): Entry | null {
  const rows = sql.select().from(entries).where(and(eq(entries.id, id), isNull(entries.deleted_at))).all();
  return hydrate(sql, rows)[0] ?? null;
}

export function listEntries(sql: Sql, date: string): Entry[] {
  const rows = sql
    .select()
    .from(entries)
    .where(and(eq(entries.date, date), isNull(entries.deleted_at)))
    // rowid breaks ties in insertion order, so equal timestamps still sort the same way every time.
    .orderBy(asc(entries.logged_at), asc(entries.created_at), asc(rawSql`rowid`))
    .all();
  return hydrate(sql, rows);
}

const groupRank = (group: FoodGroup) => FOOD_GROUPS.indexOf(group);
const muscleRank = (muscle: Muscle) => MUSCLES.indexOf(muscle);

function hydrate(sql: Sql, rows: (typeof entries.$inferSelect)[]): Entry[] {
  if (rows.length === 0) return [];
  const entryIds = rows.map((r) => r.id);
  const foods = sql.select().from(foodItems).where(inArray(foodItems.entry_id, entryIds)).orderBy(asc(foodItems.position)).all();
  const exercises = sql.select().from(exerciseItems).where(inArray(exerciseItems.entry_id, entryIds)).orderBy(asc(exerciseItems.position)).all();
  const groups = foods.length === 0 ? [] : sql.select().from(foodItemGroups).where(inArray(foodItemGroups.food_item_id, foods.map((f) => f.id))).all();
  const muscles = exercises.length === 0 ? [] : sql.select().from(exerciseMuscles).where(inArray(exerciseMuscles.exercise_item_id, exercises.map((x) => x.id))).all();

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    logged_at: row.logged_at,
    source: row.source as EntrySource,
    message_id: row.message_id,
    edited: row.edited,
    foods: foods
      .filter((f) => f.entry_id === row.id)
      .map(({ entry_id: _entryId, ...food }): FoodItem => ({
        ...food,
        groups: groups
          .filter((g) => g.food_item_id === food.id)
          .map((g) => ({ group: g.food_group as FoodGroup, portions: g.portions }))
          .sort((a, b) => groupRank(a.group) - groupRank(b.group)),
      })),
    exercises: exercises
      .filter((x) => x.entry_id === row.id)
      .map(({ entry_id: _entryId, ...exercise }): ExerciseItem => ({
        ...exercise,
        category: exercise.category as ExerciseCategory,
        muscles: muscles
          .filter((m) => m.exercise_item_id === exercise.id)
          .map((m) => ({ muscle: m.muscle as Muscle, role: m.role as MuscleRole }))
          .sort((a, b) => muscleRank(a.muscle) - muscleRank(b.muscle)),
      })),
  }));
}
