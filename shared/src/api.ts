import type { Activity, ExerciseCategory, EntrySource, FoodGroup, Muscle, MuscleRole } from "./vocab.ts";
import type { Profile } from "./schemas.ts";

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
  groups: { group: FoodGroup; portions: number }[];
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
}

export interface ProfileView {
  profile: Profile;
  /** Baseline targets before overrides, for showing beside the override fields. */
  calculated: MacroTargets;
}

export interface EntryResult {
  entry: Entry;
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

export interface ApiErrorBody {
  error: string;
  issues?: { path: string; message: string }[];
}
