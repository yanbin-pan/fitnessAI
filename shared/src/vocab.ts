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

/** The sport an exercise was (spec §5.1). `category` drives muscle volume and habits; this drives the icon. */
export const ACTIVITIES = ["tennis", "gym", "wakeboarding", "kitesurfing", "other"] as const;
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

export const ENTRY_SOURCES = ["coach", "photo", "saved_food", "manual", "apple_health"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** How far back the coach may log or change things (spec §7.5). */
export const MAX_BACKDATE_DAYS = 7;

/** How many photos one message can carry (spec §6.5). */
export const MAX_PHOTOS_PER_MESSAGE = 4;
