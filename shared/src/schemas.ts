import { z } from "zod";
import { isIsoDate, isTimeZone } from "./dates.ts";
import { HEALTH_CONDITIONS, LAB_MARKERS, MAX_LAB_PHOTOS, MAX_LAB_RESULTS } from "./health.ts";
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

/** A condition chip from the Health tab; `other` carries the person's own words. */
export const ConditionInput = z
  .object({ kind: z.enum(HEALTH_CONDITIONS), label: z.string().trim().max(80).nullable().default(null) })
  .refine((c) => c.kind !== "other" || Boolean(c.label), { message: "Say what the condition is", path: ["label"] })
  .transform((c) => ({ kind: c.kind, label: c.kind === "other" ? c.label : null }));
export type ConditionInput = z.input<typeof ConditionInput>;

export const MedicationInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    dose: z.string().trim().max(100).default(""),
    started_on: IsoDate.nullable().default(null),
    stopped_on: IsoDate.nullable().default(null),
  })
  .refine((m) => !m.started_on || !m.stopped_on || m.started_on <= m.stopped_on, { message: "Stopped before it started", path: ["stopped_on"] });
export type MedicationInput = z.input<typeof MedicationInput>;

const rangeEnd = z.number().finite().nullable().default(null);

export const LabResultInput = z.object({
  marker: z.enum(LAB_MARKERS),
  name: z.string().trim().min(1).max(100),
  printed_name: z.string().trim().max(100).default(""),
  value: z.number().finite().nullable(),
  text_value: z.string().trim().max(60).default(""),
  unit: z.string().trim().max(30).default(""),
  ref_low: rangeEnd,
  ref_high: rangeEnd,
}).refine((r) => r.value !== null || r.text_value !== "", { message: "A result needs a value", path: ["value"] });
export type LabResultInput = z.input<typeof LabResultInput>;

/** A blood test report as the person confirmed it: nothing is saved before they do. */
export const LabReportInput = z.object({
  taken_on: IsoDate,
  lab_name: z.string().trim().max(100).default(""),
  results: z.array(LabResultInput).min(1).max(MAX_LAB_RESULTS),
});
export type LabReportInput = z.input<typeof LabReportInput>;

/** Photos of a lab report for Claude to read (POST /api/records/labs/read). */
export const LabReadInput = z
  .object({ photo_ids: z.array(PhotoId).min(1).max(MAX_LAB_PHOTOS) })
  .refine((m) => new Set(m.photo_ids).size === m.photo_ids.length, { message: "Each photo can be attached once", path: ["photo_ids"] });
export type LabReadInput = z.infer<typeof LabReadInput>;

/** A sentence typed on the Health tab, for Claude to turn into conditions and medications. */
export const HealthParseInput = z.object({ text: z.string().trim().min(1).max(500) });
export type HealthParseInput = z.infer<typeof HealthParseInput>;
