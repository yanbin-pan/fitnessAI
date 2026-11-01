import type { AlcoholWeek } from "./alcohol.ts";
import type { Activity, BodyGoal, Drink, ExerciseCategory, EntrySource, FoodGroup, FrequentSlot, Muscle, MuscleRole } from "./vocab.ts";
import type { CompanionStatus } from "./companions.ts";
import type { NutrientSignals } from "./nutrients.ts";
import type { ExerciseItemInput, FoodItemInput, MicroAmount, Profile } from "./schemas.ts";
import type { Reaction } from "./reactions.ts";

// Shapes the API returns. The server builds them; the web app renders them.

export interface MacroTargets {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

export interface Totals extends MacroTargets {
  saturated_fat_g: number;
  sugars_g: number;
  salt_g: number;
  fluid_ml: number;
  alcohol_units: number;
}

export interface FoodItem extends Totals {
  id: string;
  position: number;
  name: string;
  quantity: string;
  grams: number | null;
  assumption: string;
  saved_food_id: string | null;
  /** The kind of alcoholic drink; null for food and for drinks without alcohol. */
  drink: Drink | null;
  groups: { group: FoodGroup; portions: number }[];
  /** The coach's estimate of its vitamins and minerals; null when nobody estimated them. */
  micros: MicroAmount[] | null;
  /** Free sugars: added to food, plus juice, honey and syrups; null when nobody estimated them (logged before 2026-10-17). */
  added_sugars_g: number | null;
}

export interface ExerciseItem {
  id: string;
  position: number;
  name: string;
  category: ExerciseCategory;
  activity: Activity;
  duration_min: number | null;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  distance_km: number | null;
  avg_hr: number | null;
  met: number | null;
  /** Active kcal (spec §7.3). */
  kcal: number;
  kcal_measured: boolean;
  assumption: string;
  muscles: { muscle: Muscle; role: MuscleRole }[];
}

export interface Entry {
  id: string;
  date: string;
  logged_at: string;
  source: EntrySource;
  message_id: string | null;
  edited: boolean;
  foods: FoodItem[];
  exercises: ExerciseItem[];
}

export interface DayTargets {
  base: MacroTargets;
  adjusted: MacroTargets;
  add_back_kcal: number;
  workout_kcal: number;
}

export type MessageRole = "user" | "assistant" | "note";
export type MessageStatus = "pending" | "done" | "failed";
export interface Card {
  type: "entry";
  id: string;
}

export interface ChatMessage {
  id: string;
  date: string;
  role: MessageRole;
  text: string;
  /** User messages only: the ids of its photos, in the order attached; empty otherwise. */
  photo_ids: string[];
  /** User messages only. */
  status: MessageStatus | null;
  error_code: string | null;
  cards: Card[];
  /** On a reply: the user message it answers. */
  reply_to: string | null;
  /** User messages only: the companion's emoji reaction, like a tapback; null for none. */
  reaction: Reaction | null;
  sent_at: string | null;
  created_at: string;
}

export interface DayView {
  date: string;
  /** Today's date in the profile timezone, so the client never guesses. */
  today: string;
  targets: DayTargets;
  totals: Totals;
  entries: Entry[];
  /** Entries that this day's coach replies created or changed but that are dated another day (back-dated); shown with their reply, never counted in this day's totals. */
  linked_entries: Entry[];
  messages: ChatMessage[];
  /** The editor's featured activities for this person: their four most-logged over the 60 days ending on this day, filled from a starter set (spec §11.1). */
  featured: Activity[];
  /**
   * Today only: what the chat bar's quick button offers (2026-11-01 frequent items), pinned items first, then regulars
   * found in the log that are not pinned; each nearest its usual time of day first. Empty on other days.
   */
  quick: QuickItem[];
  /**
   * How fats, sugar, salt, vitamins and minerals look over the last 7 complete days (the 7 ending on this day, for a past
   * day): words, never numbers (2026-10-06 nutrients design).
   */
  nutrients: NutrientSignals;
  /** How the companion feels as of today, whichever day is open: from the rolling week (2026-10-08 companions design §3). */
  companion: CompanionStatus;
  /** The alcohol of the 7 days ending on this day; null when none was logged in them (2026-10-08 alcohol design §3). */
  alcohol: AlcoholWeek | null;
}

export type RegularKind = "meal" | "activity";

/** A meal or activity found to recur in what someone logs (2026-10-06 design §2). */
export interface Regular {
  /** Stable while the pattern lasts: the hash of its usual items. */
  key: string;
  kind: RegularKind;
  name: string;
  /** What a tap logs. */
  foods: FoodItemInput[];
  exercises: ExerciseItemInput[];
  /** Eaten kcal for a meal, active kcal for an activity. */
  kcal: number;
  /** HH:MM, the middle of the times it was logged at. */
  typical_time: string;
  /** Different days it was seen in the window. */
  days_seen: number;
  last_seen: string;
  /** The person changed its name or items. */
  edited: boolean;
  logged_today: boolean;
}

/** A meal or activity the person pinned to log with a tap (2026-11-01 frequent items). */
export interface FrequentItem {
  id: string;
  kind: RegularKind;
  name: string;
  foods: FoodItemInput[];
  exercises: ExerciseItemInput[];
  kcal: number;
  slot: FrequentSlot;
  /** The regular it was pinned from, which is no longer suggested; null when made by hand or from an entry. */
  source_key: string | null;
  /** Times logged with a tap in the last four weeks. */
  times_logged: number;
  logged_today: boolean;
}

/** One chip behind the quick button: a pinned item (ref "f:<id>") or a regular suggested from the log (ref "r:<key>"). */
export interface QuickItem {
  ref: string;
  kind: RegularKind;
  name: string;
  kcal: number;
  /** The first exercise's activity, for the chip's icon; null for a meal. */
  activity: Activity | null;
  pinned: boolean;
  /** Not logged today, and now is its usual time: the quick button shows a dot while anything is due. */
  due: boolean;
  logged_today: boolean;
}

/** What GET /api/frequent returns: the pinned items, and the regulars that could still be pinned. */
export interface FrequentView {
  items: FrequentItem[];
  suggestions: Regular[];
}

/** What GET /api/regulars returns. */
export interface RegularsView {
  /** Days with anything logged in the window; regulars appear once it reaches required_days. */
  data_days: number;
  required_days: number;
  window_days: number;
  regulars: Regular[];
}

export interface ProfileView {
  profile: Profile;
  /** While the companion was changed in the last 3 months: the first day it can be changed again. Null otherwise. */
  companion_locked_until: string | null;
  /** Baseline targets before overrides, for showing beside the override fields. */
  calculated: MacroTargets;
}

export interface EntryResult {
  entry: Entry;
  day: DayView;
}

/** Pasted entries, in the order they were asked for, and the day they went to. */
export interface EntriesResult {
  entries: Entry[];
  day: DayView;
}

export interface DeleteResult {
  day: DayView;
}

export interface MessageResult {
  user: ChatMessage;
  reply: ChatMessage | null;
  day: DayView;
}

/** The live steps' events (spec §6.3), as POST /api/messages and Retry stream them when asked to. */
export interface CoachStreamEvents {
  stored: { day: DayView };
  step: { text: string };
  result: MessageResult;
}

/** What POST /api/photos returns (spec §12). */
export interface PhotoUpload {
  id: string;
  media_type: string;
  bytes: number;
  width: number;
  height: number;
}

export interface ApiErrorBody {
  error: string;
  issues?: { path: string; message: string }[];
}

/** One day in the calendar (spec §12): what was eaten against that day's adjusted target. */
export interface DaySummary {
  date: string;
  kcal: number;
  target_kcal: number;
}

/** What GET /api/days?from=&to= returns: the current body goal, which decides the colours' direction, and the days with food. */
export interface DaySummaries {
  goal: BodyGoal;
  days: DaySummary[];
}

export type FindingSeverity = "good" | "watch" | "act";
export type RecoveryStatus = "fresh" | "balanced" | "fatigued" | "overreaching";

export interface InsightFinding {
  title: string;
  detail: string;
  severity: FindingSeverity;
  /** Foods that would close a gap; empty when none apply. */
  foods: string[];
}

/** The coach's weekly analysis (2026-10-06 design §3.3), written in the person's language. */
export interface InsightReport {
  headline: string;
  nutrition: { summary: string; findings: InsightFinding[] };
  training: { summary: string; findings: InsightFinding[] };
  recovery: { status: RecoveryStatus; detail: string };
  focus: string[];
}

/** One nutrient's daily average against its target, over the days with food logged. */
export interface NutrientStat {
  average: number;
  target: number | null;
}

/** The numbers an analysis is written from (2026-10-06 design §3.2), worked out in code, never by the model. */
export interface InsightStats {
  period_start: string;
  period_end: string;
  days_logged: number;
  food_days: number;
  nutrients: {
    kcal: NutrientStat; protein_g: NutrientStat; carbs_g: NutrientStat; fat_g: NutrientStat; fibre_g: NutrientStat;
    saturated_fat_g: NutrientStat; sugars_g: NutrientStat; salt_g: NutrientStat; fluid_ml: NutrientStat;
  };
  protein_g_per_kg: number;
  alcohol_units_per_week: number;
  /** Average portions a day for each food group. */
  food_groups: Partial<Record<FoodGroup, number>>;
  training: {
    sessions_per_week: number;
    minutes_per_week: number;
    active_kcal_per_week: number;
    /** kcal is missing from reports written before 2026-11-01. */
    by_activity: { activity: Activity; sessions: number; minutes: number; kcal?: number }[];
    /** Weekly sets per muscle: a primary muscle counts a set, a secondary half. */
    sets_per_muscle: Partial<Record<Muscle, number>>;
    training_days_last_7: number;
    longest_streak: number;
    /** Active kcal of the last 7 days over the weekly average of the 28: about 0.8 to 1.3 is steady. */
    load_ratio: number | null;
    /** The days with training in the period; missing from reports written before 2026-11-01. */
    dates?: string[];
  };
  /** The same calm signals as the day view, over the four weeks. */
  signals: NutrientSignals;
}

/** One week's averages, worked out from the log (2026-11-01 insights history design): what Trends plots and what each
 *  report's numbers are compared with. No model call is involved. */
export interface WeekPoint {
  /** The Monday that starts the week (or the first day of a report's 7-day period). */
  week_start: string;
  food_days: number;
  kcal: number;
  kcal_target: number | null;
  protein_g: number;
  protein_target: number | null;
  protein_g_per_kg: number;
  carbs_g: number;
  carbs_target: number | null;
  fat_g: number;
  fat_target: number | null;
  saturated_fat_g: number;
  /** Upper limits: saturated fat by sex, total sugars and salt (UK reference intakes). */
  saturated_fat_max: number | null;
  fibre_g: number;
  fibre_target: number | null;
  sugars_g: number;
  sugars_max: number | null;
  salt_g: number;
  salt_max: number | null;
  alcohol_units: number;
  sessions: number;
  minutes: number;
  active_kcal: number;
  /** The week's training by activity, most sessions first: Trends' training breakdown. */
  by_activity: { activity: Activity; sessions: number; minutes: number; kcal: number }[];
}

/** A stored report, as a stored report is shown: its numbers, the coach's text, and the week before for comparison. */
export interface InsightPayload {
  week_start: string;
  generated_at: string;
  stats: InsightStats;
  /** Null when the coach is off: the numbers alone. */
  report: InsightReport | null;
  /** The 7 days before the report's period; null for older four-week reports. */
  previous: WeekPoint | null;
}

/** A past report in the list. */
export interface InsightSummary {
  week_start: string;
  period_start: string;
  period_end: string;
  headline: string;
  /** How many findings were going well, to watch and to change. */
  tally: Record<FindingSeverity, number>;
}

/** What GET /api/insights/history returns: every stored report, newest first, and the weekly averages, oldest first. */
export interface InsightsHistory {
  reports: InsightSummary[];
  weeks: WeekPoint[];
}

/** What GET /api/insights returns. */
export interface InsightsView {
  /** collecting: not enough days yet; pending: being written; ready: a report; off: the coach is switched off. */
  status: "collecting" | "pending" | "ready" | "off";
  data_days: number;
  required_days: number;
  /** The Monday the next report is due. */
  next_update: string;
  insight: InsightPayload | null;
}
