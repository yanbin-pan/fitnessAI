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

/**
 * Day-to-day activity EXCLUDING workouts (spec §5, profile.activity_level); workouts are added back separately (spec §7.2).
 * Factors are physical activity levels (PAL, TEE ÷ BMR) for the job and daily life alone, midpoints of the DGE/FAO bands
 * that leave out sport: desk 1.4–1.5, some walking 1.6–1.7, mostly standing 1.8–1.9, physical work 2.0–2.4.
 * The Mifflin-St Jeor 1.2–1.725 ladder would be wrong here: it counts the week's exercise, which we add from the log instead.
 */
export const ACTIVITY_LEVEL_KEYS = ["sedentary", "light", "moderate", "very"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVEL_KEYS)[number];
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.45,
  light: 1.65,
  moderate: 1.85,
  very: 2.2,
};

export const BODY_GOALS = ["lose", "maintain", "gain"] as const;
export type BodyGoal = (typeof BODY_GOALS)[number];

export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

export const ENTRY_SOURCES = ["coach", "photo", "saved_food", "manual", "apple_health", "regular"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** How far back the coach may log or change things (spec §7.5). */
export const MAX_BACKDATE_DAYS = 7;

/** Most entries pasted onto a day at once: a full day's worth. */
export const MAX_COPIES = 50;

/**
 * How many days before today keep the full chat: the coach on that day, and its conversation and photos (spec §6.6).
 * Today and the three before it; on a rolling basis, an older day keeps only its logbook.
 */
export const CHAT_WINDOW_DAYS = 3;

/** The accepted range of each number in the profile, shared by the server's check and the settings form's. */
export const PROFILE_RANGES = {
  height_cm: [100, 250],
  weight_kg: [30, 300],
  goal_rate_kg_week: [0, 1],
  protein_g_per_kg: [0.5, 3.5],
  fat_pct: [15, 50],
  fibre_g: [0, 80],
  add_back_pct: [0, 100],
} as const satisfies Record<string, readonly [number, number]>;

/** The longest name Zabaione keeps for the person. */
export const MAX_NAME_LENGTH = 40;

/**
 * The companions someone can pick (2026-10-08 companions design §2), named after Italian desserts. The one picked is
 * also the coach's name; Zabaione is the default for anyone who never picked.
 */
export const COMPANIONS = ["tiramisu", "panna-cotta", "zabaione", "cannolo", "bombolone", "sfogliatella", "meringa", "cantuccio"] as const;
export type CompanionId = (typeof COMPANIONS)[number];
export const DEFAULT_COMPANION: CompanionId = "zabaione";

/** Each companion's name, accents kept, in every language. */
export const COMPANION_NAMES: Record<CompanionId, string> = {
  tiramisu: "Tiramisù",
  "panna-cotta": "Panna Cotta",
  zabaione: "Zabaione",
  cannolo: "Cannolo",
  bombolone: "Bombolone",
  sfogliatella: "Sfogliatella",
  meringa: "Meringa",
  cantuccio: "Cantuccio",
};

/** Each companion's animal as the coach is told it. */
export const COMPANION_ANIMALS: Record<CompanionId, string> = {
  tiramisu: "bear cub",
  "panna-cotta": "elephant",
  zabaione: "Shiba Inu",
  cannolo: "capybara",
  bombolone: "pig",
  sfogliatella: "tiger",
  meringa: "sheep",
  cantuccio: "horse",
};

/**
 * The kinds of alcoholic drink, each with its own badge on Today (2026-10-08 alcohol design §1): cider goes with beer,
 * prosecco and champagne with wine, spirits and shots with cocktails.
 */
export const DRINKS = ["beer", "wine", "cocktail"] as const;
export type Drink = (typeof DRINKS)[number];

/** What counts as interacting with the companion, for the owner's dashboard: a tap to pet it, and opening its bubble. */
export const COMPANION_INTERACTIONS = ["pet", "open"] as const;
export type CompanionInteraction = (typeof COMPANION_INTERACTIONS)[number];

/** How often the companion can be changed (2026-10-08 companions design §7). */
export const COMPANION_CHANGE_MONTHS = 3;

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

/**
 * Frequent items (2026-11-01): what someone pins to log with a tap, each shown around a part of the day. The parts are
 * [start, end) in minutes after local midnight; "any" has no part of its own and follows when the item is logged.
 */
export const FREQUENT_SLOTS = ["any", "morning", "midday", "evening"] as const;
export type FrequentSlot = (typeof FREQUENT_SLOTS)[number];
export const SLOT_MINUTES: Record<Exclude<FrequentSlot, "any">, readonly [number, number]> = {
  morning: [300, 660],
  midday: [660, 960],
  evening: [960, 1380],
};

/** The part of the day a time (HH:MM) falls in; night hours count as "any". */
export function slotOf(hhmm: string): FrequentSlot {
  const [h, m] = hhmm.split(":").map(Number);
  const minutes = h * 60 + m;
  for (const slot of ["morning", "midday", "evening"] as const) {
    const [start, end] = SLOT_MINUTES[slot];
    if (minutes >= start && minutes < end) return slot;
  }
  return "any";
}

/** Insights (2026-10-06 design §3): written weekly, once there are seven days of data. Each report covers the past week
 *  (2026-11-01 insights history design); training load still compares that week with the four weeks it ends. */
export const INSIGHTS_MIN_DATA_DAYS = 7;
export const INSIGHTS_WINDOW_DAYS = 7;
export const INSIGHTS_LOAD_DAYS = 28;
/** The most weeks the Trends view plots. */
export const INSIGHTS_TREND_WEEKS = 52;

/**
 * The vitamins and minerals the coach estimates per food (2026-10-06 nutrients design): each name ends in its unit.
 * Rough estimates by design, so the app shows them as words, never as numbers against a target.
 */
export const MICROS = [
  "vitamin_a_ug", "vitamin_c_mg", "vitamin_d_ug", "vitamin_e_mg", "vitamin_b12_ug", "folate_ug",
  "calcium_mg", "iron_mg", "magnesium_mg", "potassium_mg", "zinc_mg",
] as const;
export type Micro = (typeof MICROS)[number];

/** What a memory of the coach is about (2026-11-02 memories design). */
export const MEMORY_KINDS = ["preference", "routine", "plan", "training", "commitment"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** One memory is one short sentence. */
export const MAX_MEMORY_LENGTH = 200;
