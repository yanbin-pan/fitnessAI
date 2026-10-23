// The web app's view of the shared code. Only dates, vocabularies, the calendar rule, the companion's constants, the alcohol and the fat & sugar helpers are runtime
// imports; the rest is types, so Zod never ends up in the browser bundle.
export { calorieStatus } from "../../shared/src/calendar.ts";
export type { CalorieStatus } from "../../shared/src/calendar.ts";
export { addDays, chatOpen, daysBetween, isIsoDate, isTimeZone } from "../../shared/src/dates.ts";
export {
  ACTIVITIES, ACTIVITY_LEVEL_KEYS, BODY_GOALS, COMPANIONS, COMPANION_CHANGE_MONTHS, COMPANION_NAMES, DEFAULT_COMPANION, DRINKS, EXERCISE_CATEGORIES,
  LANGUAGES, MAX_BACKDATE_DAYS, MAX_COPIES, MICROS, MAX_NAME_LENGTH, MAX_PHOTOS_PER_MESSAGE, PROFILE_RANGES, SEXES,
} from "../../shared/src/vocab.ts";
export type { Activity, ActivityLevel, BodyGoal, CompanionId, Drink, ExerciseCategory, Language, Micro, Sex } from "../../shared/src/vocab.ts";
export type { Reaction } from "../../shared/src/reactions.ts";
export { DOUBT_REACTIONS } from "../../shared/src/reactions.ts";
export { COMPANION_THRIVE_DAYS } from "../../shared/src/companions.ts";
export { ALCOHOL_WEEK_GUIDE, KCAL_PER_UNIT, isDrink } from "../../shared/src/alcohol.ts";
export type { AlcoholStatus, AlcoholWeek, DrinkTotal } from "../../shared/src/alcohol.ts";
export { ADDED_SUGARS_MAX_G, SATURATED_FAT_MAX_G, fatSugarDay } from "../../shared/src/fatsugar.ts";
export type { FatSugarDay } from "../../shared/src/fatsugar.ts";
export type { CompanionMood, CompanionStatus } from "../../shared/src/companions.ts";
export { MODERATE, SIGNAL_KEYS } from "../../shared/src/nutrients.ts";
export type { NutrientLevel, NutrientSignals, SignalKey } from "../../shared/src/nutrients.ts";
export { DOCUMENT_KINDS, FACT_KINDS, FOOD_LEVELS, HEALTH_CONDITIONS, LAB_MARKERS, LEVELLED_KINDS, MAX_LAB_PHOTOS, hasLevel, kindOfCode, labFlag } from "../../shared/src/health.ts";
export type * from "../../shared/src/health.ts";
export {
  ALCOHOL_HABITS, COACH_TONES, COFFEE_HABITS, COOKING, EXPERIENCES, FOCUSES, MAX_SESSIONS_WEEK, MEAL_PATTERNS, SKIN_GOALS, SKIN_TRIGGERS, SKIN_TYPES, SPORTS,
} from "../../shared/src/about.ts";
export type * from "../../shared/src/about.ts";
export type * from "../../shared/src/api.ts";
export { MAX_TIP_NUTRIENTS, TIP_IDS, tipsAllowedBy } from "../../shared/src/tips.ts";
export type { SeenTip, TipId, TipVars, TipsView } from "../../shared/src/tips.ts";
export type { CompanionInteractionInput, DocumentInput, TipSeenInput, ExerciseItemInput, About, FactDraftInput, FactInput, FoodItemInput, HealthChatInput, MessageInput, ObservationInput, Profile, ProfileInput } from "../../shared/src/schemas.ts";
