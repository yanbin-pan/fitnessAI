import { z } from "zod";
import { isIsoDate, isTimeZone } from "./dates.ts";
import {
  DOCUMENT_KINDS, FACT_KINDS, FACT_STATUSES, FOOD_LEVELS, HEALTH_CONDITIONS, LAB_MARKERS, LEVELLED_KINDS, MAX_DOCUMENT_FACTS, MAX_LAB_PHOTOS, MAX_OBSERVATIONS, hasLevel,
} from "./health.ts";
import type { FactKind, FoodLevel, HealthCondition } from "./health.ts";
import {
  ALCOHOL_HABITS, COACH_TONES, COFFEE_HABITS, COOKING, EXPERIENCES, FOCUSES, MAX_SESSIONS_WEEK, MEAL_PATTERNS, SKIN_GOALS, SKIN_TRIGGERS, SKIN_TYPES, SPORTS,
} from "./about.ts";
import {
  ACTIVITIES, ACTIVITY_LEVEL_KEYS, BODY_GOALS, COMPANIONS, COMPANION_INTERACTIONS, DEFAULT_COMPANION, DRINKS, EXERCISE_CATEGORIES, FOOD_GROUPS, LANGUAGES, MAX_COPIES, MAX_NAME_LENGTH, MAX_PHOTOS_PER_MESSAGE, MICROS, MUSCLES, MUSCLE_ROLES, PROFILE_RANGES, SEXES,
} from "./vocab.ts";

// Request bodies the API accepts. Each schema's parsed output (defaults filled in)
// is exported as a type of the same name.

export const IsoDate = z.string().refine(isIsoDate, { message: "Expected a date as YYYY-MM-DD" });
export const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const amount = z.number().nonnegative();
const optionalPositive = z.number().positive().nullable().default(null);

export const FoodGroupPortion = z.object({ group: z.enum(FOOD_GROUPS), portions: z.number().positive() });
/** One vitamin or mineral in a portion, in the unit its name ends in. */
export const MicroAmount = z.object({ nutrient: z.enum(MICROS), amount: z.number().nonnegative() });
export type MicroAmount = z.infer<typeof MicroAmount>;
export const MuscleWork = z.object({ muscle: z.enum(MUSCLES), role: z.enum(MUSCLE_ROLES) });

export const FoodItemInput = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(200).default(""),
  grams: z.number().positive().nullable().default(null),
  kcal: amount,
  protein_g: amount,
  carbs_g: amount,
  fat_g: amount,
  fibre_g: amount.default(0),
  saturated_fat_g: amount.default(0),
  sugars_g: amount.default(0),
  /** Free sugars (2026-10-17 fat & sugar design): added to food, plus juice, honey and syrups; null when nobody estimated them. */
  added_sugars_g: amount.nullable().default(null),
  salt_g: amount.default(0),
  fluid_ml: amount.default(0),
  alcohol_units: amount.default(0),
  /** The kind of alcoholic drink, for its badge; null for food and for drinks without alcohol. */
  drink: z.enum(DRINKS).nullable().default(null),
  assumption: z.string().max(500).default(""),
  groups: z.array(FoodGroupPortion).max(FOOD_GROUPS.length).default([]),
  /** The coach's estimate of its vitamins and minerals; null when nobody estimated them (typed in by hand). */
  micros: z.array(MicroAmount).max(MICROS.length).nullable().default(null),
});
export type FoodItemInput = z.infer<typeof FoodItemInput>;

export const ExerciseItemInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(EXERCISE_CATEGORIES),
  activity: z.enum(ACTIVITIES).default("other"),
  duration_min: optionalPositive,
  sets: optionalPositive,
  reps: optionalPositive,
  weight_kg: optionalPositive,
  distance_km: optionalPositive,
  avg_hr: optionalPositive,
  met: z.number().min(1).max(25).nullable().default(null),
  /** Active kcal. When null, the server derives it from `met` and `duration_min`. */
  kcal: amount.nullable().default(null),
  assumption: z.string().max(500).default(""),
  muscles: z.array(MuscleWork).max(MUSCLES.length * 2).default([]),
});
export type ExerciseItemInput = z.infer<typeof ExerciseItemInput>;

const items = {
  foods: z.array(FoodItemInput).max(30).default([]),
  exercises: z.array(ExerciseItemInput).max(30).default([]),
};
const hasItems = (value: { foods: unknown[]; exercises: unknown[] }) => value.foods.length + value.exercises.length > 0;
const NEEDS_ITEMS = { message: "An entry needs at least one item" };

export const ManualEntryInput = z
  .object({
    id: z.uuid(),
    date: IsoDate,
    time: z.string().regex(TIME_HHMM).nullable().default(null),
    ...items,
  })
  .refine(hasItems, NEEDS_ITEMS);
export type ManualEntryInput = z.infer<typeof ManualEntryInput>;

/**
 * Pasting copied entries onto a day, without the coach. Each copy names the entry it duplicates (`from`) and the id
 * the phone made for the new one, so pasting again after a lost reply stores each copy once.
 */
export const EntryCopyInput = z.object({
  date: IsoDate,
  copies: z
    .array(z.object({ id: z.uuid(), from: z.string().min(1).max(100) }))
    .min(1)
    .max(MAX_COPIES)
    .refine((copies) => new Set(copies.map((c) => c.id)).size === copies.length, { message: "Each copy needs its own id" }),
});
export type EntryCopyInput = z.infer<typeof EntryCopyInput>;

export const EntryPatch = z.object(items).refine(hasItems, NEEDS_ITEMS);
export type EntryPatch = z.infer<typeof EntryPatch>;

const override = z.number().nonnegative().nullable().default(null);

const inRange = (field: keyof typeof PROFILE_RANGES) => z.number().min(PROFILE_RANGES[field][0]).max(PROFILE_RANGES[field][1]);

/** A set of choices from one vocabulary, each at most once. */
const picks = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).max(values.length).transform((list) => [...new Set(list)]).default([]);
const pick = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullable().default(null);

/** What onboarding asks beyond the body numbers (2026-10-20 onboarding and settings design). Every answer is optional. */
export const AboutInput = z.object({
  focus: picks(FOCUSES),
  target_weight_kg: inRange("weight_kg").nullable().default(null),
  sports: picks(SPORTS),
  sessions_week: z.number().int().min(0).max(MAX_SESSIONS_WEEK).nullable().default(null),
  experience: pick(EXPERIENCES),
  meals: pick(MEAL_PATTERNS),
  cooking: pick(COOKING),
  alcohol: pick(ALCOHOL_HABITS),
  coffee: pick(COFFEE_HABITS),
  skin_goals: picks(SKIN_GOALS),
  skin_triggers: picks(SKIN_TRIGGERS),
  skin_type: pick(SKIN_TYPES),
});
export type AboutInput = z.input<typeof AboutInput>;
export type About = z.output<typeof AboutInput>;

export const ProfileInput = z.object({
  sex: z.enum(SEXES),
  birth_date: IsoDate,
  height_cm: inRange("height_cm"),
  weight_kg: inRange("weight_kg"),
  activity_level: z.enum(ACTIVITY_LEVEL_KEYS),
  goal: z.enum(BODY_GOALS),
  goal_rate_kg_week: inRange("goal_rate_kg_week"),
  body_goal_priority: z.enum(["high", "normal"]).default("high"),
  protein_g_per_kg: inRange("protein_g_per_kg").default(1.8),
  fat_pct: inRange("fat_pct").default(30),
  fibre_g: inRange("fibre_g").default(30),
  add_back_pct: inRange("add_back_pct").default(50),
  override_kcal: override,
  override_protein_g: override,
  override_carbs_g: override,
  override_fat_g: override,
  override_fibre_g: override,
  timezone: z.string().refine(isTimeZone, { message: "Unknown timezone" }).default("Europe/London"),
  units_mass: z.enum(["kg", "st_lb"]).default("kg"),
  units_length: z.enum(["cm", "in"]).default("cm"),
  context_days: z.number().int().min(1).max(14).default(5),
  goal_notes: z.enum(["on", "off"]).default("on"),
  /** The app's language, and the one the coach replies in. */
  language: z.enum(LANGUAGES).default("en"),
  /** What Zabaione calls the person: a first name or a nickname. Blank is no name. */
  name: z.string().trim().max(MAX_NAME_LENGTH).nullable().default(null).transform((name) => (name ? name : null)),
  /** Whether Today still asks for the name: `show` until it is given or declined, then `done`. */
  name_prompt: z.enum(["show", "done"]).default("show"),
  /** The companion picked (2026-10-08 companions design): it shows how the week is going, and the coach takes its name. */
  companion: z.enum(COMPANIONS).default(DEFAULT_COMPANION),
  /** Whether Today still asks to pick one: `show` until one is picked or declined, then `done`. */
  companion_prompt: z.enum(["show", "done"]).default("show"),
  /** The answers onboarding collects beyond the body numbers. */
  about: AboutInput.prefault({}),
  coach_tone: z.enum(COACH_TONES).default("balanced"),
  /** Whether Today still offers onboarding's questions: `show` until they are finished or declined, then `done`. */
  onboarding: z.enum(["show", "done"]).default("show"),
});
/** What a client sends: fields with defaults may be omitted. */
export type ProfileInput = z.input<typeof ProfileInput>;
/** A stored profile, every field present. */
export type Profile = z.output<typeof ProfileInput>;

/** A photo id from POST /api/photos: 128 random bits in hex (spec §6.5). */
export const PhotoId = z.string().regex(/^[0-9a-f]{32}$/);

export const MessageInput = z
  .object({
    id: z.uuid(),
    sent_at: z.iso.datetime(),
    /** The day open in the app, which the message belongs to. Without it, the day it was sent. */
    date: IsoDate.optional(),
    text: z.string().trim().max(4000).default(""),
    photo_ids: z.array(PhotoId).max(MAX_PHOTOS_PER_MESSAGE).default([]),
  })
  .refine((m) => m.text.length > 0 || m.photo_ids.length > 0, { message: "A message needs text or a photo", path: ["text"] })
  .refine((m) => new Set(m.photo_ids).size === m.photo_ids.length, { message: "Each photo can be attached once", path: ["photo_ids"] });
export type MessageInput = z.infer<typeof MessageInput>;

/** An edit to a regular (2026-10-06 design §2.3): its name and what a tap logs. Regulars are never added by hand. */
export const RegularEdit = z
  .object({ name: z.string().trim().min(1).max(100), ...items })
  .refine(hasItems, NEEDS_ITEMS);
export type RegularEdit = z.infer<typeof RegularEdit>;

/** Logging a regular with a tap: the id is made on the phone, so a repeated tap logs it once. */
export const RegularLogInput = z.object({ id: z.uuid() });
export type RegularLogInput = z.infer<typeof RegularLogInput>;

/** One interaction with the companion, counted per day for the owner's dashboard (2026-10-08 companions design §8). */
export const CompanionInteractionInput = z.object({ kind: z.enum(COMPANION_INTERACTIONS) });
export type CompanionInteractionInput = z.infer<typeof CompanionInteractionInput>;

const isoOrNull = IsoDate.nullable().default(null);

const factFields = {
  kind: z.enum(FACT_KINDS),
  code: z.enum(HEALTH_CONDITIONS).nullable().default(null),
  label: z.string().trim().min(1).max(100),
  detail: z.string().trim().max(200).default(""),
  level: z.enum(FOOD_LEVELS).nullable().default(null),
  started_on: isoOrNull,
  ended_on: isoOrNull,
};

const datesInOrder = (f: { started_on: string | null; ended_on: string | null }) => !f.started_on || !f.ended_on || f.started_on <= f.ended_on;
const DATES_IN_ORDER = { message: "Ended before it started", path: ["ended_on"] };

/** A level belongs to foods only, and a food without one takes its kind's; `other` is no code at all. */
function normaliseFact<T extends { kind: FactKind; code: HealthCondition | null; level: FoodLevel | null }>(f: T): T {
  return { ...f, code: f.code === "other" ? null : f.code, level: hasLevel(f.kind) ? (f.level ?? LEVELLED_KINDS[f.kind] ?? null) : null };
}

/** A fact as the coach proposes it or a record states it (2026-10-19 health tab design §1). */
export const FactDraftInput = z.object(factFields).refine(datesInOrder, DATES_IN_ORDER).transform(normaliseFact);
export type FactDraftInput = z.input<typeof FactDraftInput>;

/** A fact as the person adds or edits it on the Health tab. */
export const FactInput = z
  .object({ ...factFields, status: z.enum(FACT_STATUSES).default("active"), shared: z.boolean().default(true) })
  .refine(datesInOrder, DATES_IN_ORDER)
  .transform(normaliseFact);
export type FactInput = z.input<typeof FactInput>;

const rangeEnd = z.number().finite().nullable().default(null);

export const ObservationInput = z.object({
  code: z.enum(LAB_MARKERS),
  name: z.string().trim().min(1).max(100),
  printed_name: z.string().trim().max(100).default(""),
  value: z.number().finite().nullable(),
  text_value: z.string().trim().max(60).default(""),
  unit: z.string().trim().max(30).default(""),
  ref_low: rangeEnd,
  ref_high: rangeEnd,
}).refine((r) => r.value !== null || r.text_value !== "", { message: "A result needs a value", path: ["value"] });
export type ObservationInput = z.input<typeof ObservationInput>;

/**
 * A record as the person checked it: nothing is saved before they do. `facts` are the ones they ticked, added at once;
 * `suggestions` the ones they left, kept on the record with an Add button.
 */
export const DocumentInput = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  taken_on: IsoDate,
  /** Empty for a record the app names by its kind ("Blood test"). */
  title: z.string().trim().max(100).default(""),
  source: z.string().trim().max(100).default(""),
  language: z.string().trim().max(40).default(""),
  summary: z.string().trim().max(1000).default(""),
  observations: z.array(ObservationInput).max(MAX_OBSERVATIONS).default([]),
  facts: z.array(FactDraftInput).max(MAX_DOCUMENT_FACTS).default([]),
  suggestions: z.array(FactDraftInput).max(MAX_DOCUMENT_FACTS).default([]),
  /** The chat message whose read this is, so the chat shows it saved. */
  message_id: z.uuid().nullable().default(null),
});
export type DocumentInput = z.input<typeof DocumentInput>;

const photoIds = z
  .array(PhotoId)
  .max(MAX_LAB_PHOTOS)
  .refine((ids) => new Set(ids).size === ids.length, { message: "Each photo can be attached once" });

/** Photos of a record for Claude to read (POST /api/records/read). */
/** Other records to fold into one: their values join it, and they are gone. */
export const DocumentMergeInput = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, { message: "Each record can be merged once" }),
});
export type DocumentMergeInput = z.infer<typeof DocumentMergeInput>;

export const DocumentReadInput = z.object({ photo_ids: photoIds.min(1) });
export type DocumentReadInput = z.infer<typeof DocumentReadInput>;

/** A message to the Health chat: words, photos of a record, or both. The id is made on the phone, so a resend is a repeat. */
export const HealthChatInput = z
  .object({ id: z.uuid(), text: z.string().trim().max(1000).default(""), photo_ids: photoIds.default([]) })
  .refine((m) => m.text !== "" || m.photo_ids.length > 0, { message: "Say something or attach a photo", path: ["text"] });
export type HealthChatInput = z.input<typeof HealthChatInput>;

/** Adding a suggestion, as found or as the person edited it. */
export const SuggestionAcceptInput = z.object({ fact: FactDraftInput.optional() });
export type SuggestionAcceptInput = z.input<typeof SuggestionAcceptInput>;
