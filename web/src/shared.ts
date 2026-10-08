// The web app's view of the shared code. Only dates, vocabularies, the calendar rule and the companion's constants are runtime
// imports; the rest is types, so Zod never ends up in the browser bundle.
export { calorieStatus } from "../../shared/src/calendar.ts";
export type { CalorieStatus } from "../../shared/src/calendar.ts";
export { addDays, chatOpen, daysBetween, isIsoDate, isTimeZone } from "../../shared/src/dates.ts";
export {
  ACTIVITIES, ACTIVITY_LEVEL_KEYS, BODY_GOALS, COMPANIONS, COMPANION_NAMES, DEFAULT_COMPANION, EXERCISE_CATEGORIES, LANGUAGES, MAX_BACKDATE_DAYS,
  MAX_NAME_LENGTH, MAX_PHOTOS_PER_MESSAGE, PROFILE_RANGES, SEXES,
} from "../../shared/src/vocab.ts";
export type { Activity, ActivityLevel, BodyGoal, CompanionId, ExerciseCategory, Language, Sex } from "../../shared/src/vocab.ts";
export { COMPANION_THRIVE_DAYS } from "../../shared/src/companions.ts";
export type { CompanionMood, CompanionStatus } from "../../shared/src/companions.ts";
export { MODERATE, SIGNAL_KEYS } from "../../shared/src/nutrients.ts";
export type { NutrientLevel, NutrientSignals, SignalKey } from "../../shared/src/nutrients.ts";
export type * from "../../shared/src/api.ts";
export type { ExerciseItemInput, FoodItemInput, MessageInput, Profile, ProfileInput } from "../../shared/src/schemas.ts";
