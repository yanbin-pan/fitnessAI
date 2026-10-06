// Fixed vocabularies (spec §5.1). They are enums in the coach's tool schemas, so
// Claude can only choose from them and charts never split across synonyms.

export const MUSCLES = [
  "chest", "upper_back", "lats", "shoulders", "biceps", "triceps",
  "forearms", "core", "glutes", "quads", "hamstrings", "calves",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_ROLES = ["primary", "secondary"] as const;
export type MuscleRole = (typeof MUSCLE_ROLES)[number];

export const FOOD_GROUPS = [
  "vegetables", "fruit", "legumes", "wholegrains", "nuts_seeds", "oily_fish",
  "red_meat", "processed_meat", "ultra_processed", "sugary_drinks", "fried_food",
] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export const EXERCISE_CATEGORIES = ["strength", "cardio", "mobility", "sport"] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

/**
 * The sport an exercise was (spec §5.1). `category` drives muscle volume and habits; this drives the badge.
 * The owner's four come first and `other` last; the rest follow the More grid's families.
 */
export const ACTIVITIES = [
  "tennis", "gym", "wakeboarding", "kitesurfing",
  "padel", "badminton",
  "running", "walking", "hiking", "photography", "cycling", "skateboarding",
  "swimming", "surfing", "rowing", "kayaking", "sailing", "diving",
  "boxing", "martial_arts", "yoga", "climbing",
  "football", "basketball", "volleyball", "rugby", "cricket", "hockey",
  "skiing", "snowboarding", "skating",
  "golf", "other",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Day-to-day activity EXCLUDING workouts (spec §5, profile.activity_level); workouts are added back separately (spec §7.2). */
export const ACTIVITY_LEVEL_KEYS = ["sedentary", "light", "moderate", "very"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVEL_KEYS)[number];
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
};

export const BODY_GOALS = ["lose", "maintain", "gain"] as const;
export type BodyGoal = (typeof BODY_GOALS)[number];

export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

export const ENTRY_SOURCES = ["coach", "photo", "saved_food", "manual", "apple_health", "regular"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** How far back the coach may log or change things (spec §7.5). */
export const MAX_BACKDATE_DAYS = 7;

/** How many photos one message can carry (spec §6.5). */
export const MAX_PHOTOS_PER_MESSAGE = 4;

/** The languages the app is translated into. The coach replies in the chosen one unless the person writes in another. */
export const LANGUAGES = ["en", "it", "zh", "lt", "fr", "de", "es"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language as the coach is told it. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  it: "Italian",
  zh: "Simplified Chinese",
  lt: "Lithuanian",
  fr: "French",
  de: "German",
  es: "Spanish",
};

/** Regulars (2026-10-06 design §2): patterns found in the last four weeks, once there are five days of data. */
export const REGULARS_WINDOW_DAYS = 28;
export const REGULARS_MIN_DATA_DAYS = 5;
/** A meal or activity becomes a regular once it is seen on this many different days in the window. */
export const REGULAR_MIN_DAYS_SEEN = 3;

/** Insights (2026-10-06 design §3): written weekly, once there are fourteen days of data. */
export const INSIGHTS_MIN_DATA_DAYS = 14;
export const INSIGHTS_WINDOW_DAYS = 28;
