import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Column names are snake_case and match the spec (§5) and the API, so rows map
// onto API objects without renaming. Keep this file free of app imports:
// drizzle-kit loads it on its own.

export const profile = sqliteTable("profile", {
  id: integer().primaryKey(),
  sex: text().notNull(),
  birth_date: text().notNull(),
  height_cm: real().notNull(),
  weight_kg: real().notNull(),
  activity_level: text().notNull(),
  goal: text().notNull(),
  goal_rate_kg_week: real().notNull(),
  body_goal_priority: text().notNull(),
  protein_g_per_kg: real().notNull(),
  fat_pct: real().notNull(),
  fibre_g: real().notNull(),
  add_back_pct: real().notNull(),
  override_kcal: real(),
  override_protein_g: real(),
  override_carbs_g: real(),
  override_fat_g: real(),
  override_fibre_g: real(),
  timezone: text().notNull(),
  units_mass: text().notNull(),
  units_length: text().notNull(),
  context_days: integer().notNull(),
  goal_notes: text().notNull(),
  language: text().notNull().default("en"),
  name: text(),
  name_prompt: text().notNull().default("show"),
  companion: text().notNull().default("zabaione"),
  companion_prompt: text().notNull().default("show"),
  /** The person's local date of the last change of companion: it can change again 3 months on. */
  companion_changed_at: text(),
  updated_at: text().notNull(),
});

export const days = sqliteTable("days", {
  date: text().primaryKey(),
  base_kcal: real().notNull(),
  base_protein_g: real().notNull(),
  base_carbs_g: real().notNull(),
  base_fat_g: real().notNull(),
  base_fibre_g: real().notNull(),
  add_back_pct: real().notNull(),
  weight_kg_used: real().notNull(),
  created_at: text().notNull(),
  updated_at: text().notNull(),
});

export const entries = sqliteTable(
  "entries",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    logged_at: text().notNull(),
    source: text().notNull(),
    message_id: text(),
    external_id: text().unique(),
    merged_into_entry_id: text(),
    edited: integer({ mode: "boolean" }).notNull().default(false),
    deleted_at: text(),
    /** Set when a regular was logged with a tap: the entry counts towards that regular whatever its items. */
    regular_key: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index("entries_date_idx").on(t.date)],
);

export const foodItems = sqliteTable(
  "food_items",
  {
    id: text().primaryKey(),
    entry_id: text().notNull().references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    quantity: text().notNull(),
    grams: real(),
    kcal: real().notNull(),
    protein_g: real().notNull(),
    carbs_g: real().notNull(),
    fat_g: real().notNull(),
    fibre_g: real().notNull(),
    saturated_fat_g: real().notNull(),
    sugars_g: real().notNull(),
    salt_g: real().notNull(),
    fluid_ml: real().notNull(),
    alcohol_units: real().notNull(),
    /** beer, wine or cocktail for an alcoholic drink; null for food and drinks without alcohol. */
    drink: text(),
    assumption: text().notNull(),
    saved_food_id: text(),
    /** The coach's estimate of its vitamins and minerals: [{ nutrient, amount }]. Null when nobody estimated them. */
    micros: text({ mode: "json" }).$type<{ nutrient: string; amount: number }[]>(),
  },
  (t) => [index("food_items_entry_idx").on(t.entry_id)],
);

export const foodItemGroups = sqliteTable(
  "food_item_groups",
  {
    food_item_id: text().notNull().references(() => foodItems.id, { onDelete: "cascade" }),
    food_group: text().notNull(),
    portions: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.food_item_id, t.food_group] })],
);

export const exerciseItems = sqliteTable(
  "exercise_items",
  {
    id: text().primaryKey(),
    entry_id: text().notNull().references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    category: text().notNull(),
    activity: text().notNull().default("other"),
    duration_min: real(),
    sets: real(),
    reps: real(),
    weight_kg: real(),
    distance_km: real(),
    avg_hr: real(),
    met: real(),
    kcal: real().notNull(),
    kcal_measured: integer({ mode: "boolean" }).notNull().default(false),
    assumption: text().notNull(),
  },
  (t) => [index("exercise_items_entry_idx").on(t.entry_id)],
);

export const exerciseMuscles = sqliteTable(
  "exercise_muscles",
  {
    exercise_item_id: text().notNull().references(() => exerciseItems.id, { onDelete: "cascade" }),
    muscle: text().notNull(),
    role: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.exercise_item_id, t.muscle] })],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    role: text().notNull(),
    text: text().notNull(),
    photo_ids: text({ mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    cards: text({ mode: "json" }).$type<{ type: "entry"; id: string }[]>().notNull(),
    status: text(),
    error_code: text(),
    reply_to: text().unique(),
    sent_at: text(),
    created_at: text().notNull(),
  },
  (t) => [index("messages_date_idx").on(t.date), index("messages_created_idx").on(t.created_at)],
);

/** One coach thread per day; `system` is frozen at the day's first message (spec §6.2). */
export const coachThreads = sqliteTable("coach_threads", {
  date: text().primaryKey(),
  system: text().notNull(),
  created_at: text().notNull(),
});

/** The exact Claude API turns, replayed append-only. */
export const coachTurns = sqliteTable(
  "coach_turns",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    date: text().notNull(),
    seq: integer().notNull(),
    role: text().notNull(),
    blocks: text({ mode: "json" }).$type<unknown[]>().notNull(),
    message_id: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [uniqueIndex("coach_turns_date_seq_idx").on(t.date, t.seq)],
);

/** Photos for the coach (spec §6.5). The file is <photoDir>/<id>.jpg or .png; the row and the file go together. */
export const photos = sqliteTable(
  "photos",
  {
    id: text().primaryKey(),
    /** Null until a message claims the photo. */
    message_id: text(),
    media_type: text().notNull(),
    bytes: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    created_at: text().notNull(),
  },
  (t) => [index("photos_message_idx").on(t.message_id), index("photos_created_idx").on(t.created_at)],
);

/**
 * One row per coach run that reached Claude, success or failure: what the daily cap counts (spec §6.4). `date` is the
 * person's local date when the run started; `model` the model that last answered. Kept when its message is deleted.
 */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    message_id: text().notNull(),
    model: text(),
    calls: integer().notNull(),
    input_tokens: integer().notNull(),
    output_tokens: integer().notNull(),
    cache_read_tokens: integer().notNull(),
    cache_write_tokens: integer().notNull(),
    created_at: text().notNull(),
  },
  (t) => [index("ai_usage_date_idx").on(t.date)],
);


/**
 * What the person changed about a regular (2026-10-06 design §2.3). Regulars themselves are worked out from the
 * entries on every read; this keeps only the edits (a name, the items a tap logs) and removals, by the regular's key.
 */
export const regularOverrides = sqliteTable("regular_overrides", {
  key: text().primaryKey(),
  name: text(),
  foods: text({ mode: "json" }).$type<unknown[]>(),
  exercises: text({ mode: "json" }).$type<unknown[]>(),
  dismissed: integer({ mode: "boolean" }).notNull().default(false),
  updated_at: text().notNull(),
});

/** One coach analysis per local week, written on its Monday (2026-10-06 design §3). Kept: it holds no conversation. */
export const insights = sqliteTable("insights", {
  week_start: text().primaryKey(),
  generated_at: text().notNull(),
  language: text().notNull(),
  model: text(),
  stats: text({ mode: "json" }).$type<unknown>().notNull(),
  report: text({ mode: "json" }).$type<unknown>().notNull(),
});
