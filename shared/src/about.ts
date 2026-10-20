// What onboarding asks beyond the body numbers (2026-10-20 onboarding and settings design): what the person wants to
// work on, how they train and eat, their skin, and how the coach should talk. Kept free of Zod so the web app can
// import the vocabularies at runtime. Health conditions, allergies, medication, injuries, diets and foods to skip are
// not here: they are health facts (health.ts), behind the Health tab's consent.

/** What the person wants to work on. Several can be picked; each may add a screen or a line in the plan. */
export const FOCUSES = ["lose_fat", "build_muscle", "stay_in_shape", "skin", "bloods", "energy", "gut", "event"] as const;
export type Focus = (typeof FOCUSES)[number];

export const SPORTS = ["gym", "padel", "running", "cycling", "swimming", "yoga", "team"] as const;
export type Sport = (typeof SPORTS)[number];

export const EXPERIENCES = ["new", "under_2", "over_2"] as const;
export type Experience = (typeof EXPERIENCES)[number];

export const MEAL_PATTERNS = ["three", "snacks", "skip_breakfast", "time_restricted"] as const;
export type MealPattern = (typeof MEAL_PATTERNS)[number];

export const COOKING = ["home", "mix", "out"] as const;
export type Cooking = (typeof COOKING)[number];

export const ALCOHOL_HABITS = ["never", "weekends", "most_days"] as const;
export type AlcoholHabit = (typeof ALCOHOL_HABITS)[number];

export const COFFEE_HABITS = ["none", "one_two", "three_plus"] as const;
export type CoffeeHabit = (typeof COFFEE_HABITS)[number];

export const SKIN_GOALS = ["glow", "breakouts", "dryness", "redness", "even_tone", "fine_lines"] as const;
export type SkinGoal = (typeof SKIN_GOALS)[number];

export const SKIN_TRIGGERS = ["sugar", "dairy", "sleep", "alcohol", "stress", "unsure"] as const;
export type SkinTrigger = (typeof SKIN_TRIGGERS)[number];

export const SKIN_TYPES = ["dry", "oily", "combination", "sensitive"] as const;
export type SkinType = (typeof SKIN_TYPES)[number];

/** How the coach talks: kind and soft, plain, or blunt. */
export const COACH_TONES = ["gentle", "balanced", "direct"] as const;
export type CoachTone = (typeof COACH_TONES)[number];

/** The most sessions a week the profile takes. */
export const MAX_SESSIONS_WEEK = 14;
