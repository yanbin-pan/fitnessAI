// The Health tab (2026-10-19 health tab design): what the coach should know about the person (facts), the records behind
// it (documents and their observations), and what the coach found but the person has not yet added (suggestions). Kept
// free of Zod so the web app can import the vocabularies at runtime.

/**
 * What a fact can be. Text in the database, so a new kind is a change here only (design §1). Food kinds carry a level.
 */
export const FACT_KINDS = ["condition", "injury", "medication", "allergy", "intolerance", "diet", "food", "target", "note"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** How strictly a food is kept out (or in): never suggested, small amounts, left out where easy, chosen more often. */
export const FOOD_LEVELS = ["never", "limit", "avoid", "prefer"] as const;
export type FoodLevel = (typeof FOOD_LEVELS)[number];

/** The kinds that take a level, and the level each starts with. */
export const LEVELLED_KINDS: Readonly<Partial<Record<FactKind, FoodLevel>>> = { allergy: "never", intolerance: "limit", food: "avoid" };
export const hasLevel = (kind: FactKind): boolean => kind in LEVELLED_KINDS;

export const FACT_STATUSES = ["active", "resolved"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/**
 * Conditions, diets and sensitivities the app names in the person's language. A fact with one of these codes shows the
 * app's name for it; any other fact shows its label.
 */
export const HEALTH_CONDITIONS = [
  "vegetarian", "vegan", "pescatarian", "halal", "kosher",
  "nut_allergy", "lactose_intolerance", "coeliac", "shellfish_allergy",
  "high_cholesterol", "prediabetes", "type2_diabetes", "high_blood_pressure",
  "ibs", "reflux",
  "pregnant", "breastfeeding", "menopause",
  "eating_disorder_history",
  "other",
] as const;
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number];

/** Each code's name in English: a fact's label when nothing better is known, and how the coach reads it. */
export const CODE_LABELS: Record<Exclude<HealthCondition, "other">, string> = {
  vegetarian: "Vegetarian", vegan: "Vegan", pescatarian: "Pescatarian", halal: "Halal", kosher: "Kosher",
  nut_allergy: "Nut allergy", lactose_intolerance: "Lactose intolerance", coeliac: "Coeliac disease", shellfish_allergy: "Shellfish allergy",
  high_cholesterol: "High cholesterol", prediabetes: "Prediabetes", type2_diabetes: "Type 2 diabetes", high_blood_pressure: "High blood pressure",
  ibs: "IBS", reflux: "Reflux",
  pregnant: "Pregnant", breastfeeding: "Breastfeeding", menopause: "Menopause",
  eating_disorder_history: "Eating disorder history",
};

/** The kind a known code belongs to, so a chip or the coach can file it. */
export function kindOfCode(code: HealthCondition): FactKind {
  if (["vegetarian", "vegan", "pescatarian", "halal", "kosher"].includes(code)) return "diet";
  if (code === "nut_allergy" || code === "shellfish_allergy") return "allergy";
  if (code === "lactose_intolerance" || code === "coeliac") return "intolerance";
  return "condition";
}

/** What a record can be. Text in the database, like the fact kinds. */
export const DOCUMENT_KINDS = ["lab", "imaging", "letter", "prescription", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Markers the app knows by a fixed code, so trends never split across a lab's spellings. Anything else on a report is
 * kept under `other` with its printed name.
 */
export const LAB_MARKERS = [
  "total_cholesterol", "ldl", "hdl", "triglycerides",
  "glucose", "hba1c",
  "ferritin", "iron", "haemoglobin", "b12", "folate", "vitamin_d",
  "tsh", "creatinine", "egfr", "alt", "ast", "crp",
  "other",
] as const;
export type LabMarker = (typeof LAB_MARKERS)[number];

/** Where a value sits against the record's own reference range; `unknown` when it gives none. */
export type LabFlag = "low" | "normal" | "high" | "unknown";

export const MAX_OBSERVATIONS = 120;
export const MAX_LAB_PHOTOS = 4;
export const MAX_DOCUMENT_FACTS = 12;

/** The flag of a value against a range, either end of which may be missing. */
export function labFlag(value: number | null, low: number | null, high: number | null): LabFlag {
  if (value === null || (low === null && high === null)) return "unknown";
  if (low !== null && value < low) return "low";
  if (high !== null && value > high) return "high";
  return "normal";
}

/** A fact before it is saved: what the coach proposes, or what a record states. */
export interface FactDraft {
  kind: FactKind;
  code: HealthCondition | null;
  /** In the person's language: their words, or the coach's. Always set, even with a code. */
  label: string;
  /** "10 mg once a day", "no deep squats", "small amounts are fine"; empty when there is none. */
  detail: string;
  /** For allergies, intolerances and food rules; null otherwise. */
  level: FoodLevel | null;
  started_on: string | null;
  ended_on: string | null;
}

export interface FactView extends FactDraft {
  id: string;
  status: FactStatus;
  /** False when the person has hidden it from the coach. */
  shared: boolean;
  /** The record it came from, when it came from one. */
  document_id: string | null;
  created_at: string;
}

export interface ObservationView {
  id: string;
  code: LabMarker;
  /** In the person's language. */
  name: string;
  /** The name as printed, when the record is in another language; empty otherwise. */
  printed_name: string;
  /** Null for a result printed as words ("Negative", "A Rh+"), which text_value then holds. */
  value: number | null;
  text_value: string;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  flag: LabFlag;
}

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  taken_on: string;
  title: string;
  /** The lab, clinic or doctor; empty when none is named. */
  source: string;
  /** The record's language, named in the person's language; empty when it is theirs. */
  language: string;
  /** What the record says, in a few plain sentences in the person's language. */
  summary: string;
  observations: ObservationView[];
  created_at: string;
}

export type SuggestionStatus = "pending" | "added" | "dismissed";

export interface SuggestionView {
  id: string;
  fact: FactDraft;
  status: SuggestionStatus;
  /** The fact it became, while added. */
  fact_id: string | null;
  /** Where it was found: a record, or a message of the chat. */
  document_id: string | null;
  message_id: string | null;
}

/** One marker across records, newest last, for its trend: only results in the latest one's unit, so they compare. */
export interface MarkerTrend {
  key: string;
  code: LabMarker;
  name: string;
  unit: string;
  points: { taken_on: string; value: number; flag: LabFlag }[];
  ref_low: number | null;
  ref_high: number | null;
}

export interface HealthView {
  /** When the person agreed to keep health records and share them with the coach; null until they do. */
  consented_at: string | null;
  facts: FactView[];
  /** Newest first. */
  documents: DocumentView[];
  trends: MarkerTrend[];
  /** Waiting for the person's OK, oldest first. */
  suggestions: SuggestionView[];
}

/** What Claude read from photos of a record, for the person to check before anything is saved. */
export interface DocumentReadView {
  kind: DocumentKind;
  taken_on: string | null;
  title: string;
  source: string;
  language: string;
  summary: string;
  observations: Omit<ObservationView, "id" | "flag">[];
  /** Diagnoses, medicines, injuries and advice the record states, for the person to tick. */
  facts: FactDraft[];
}

export interface ChatMessageView {
  id: string;
  role: "user" | "coach";
  text: string;
  /** How many photos the person sent with it. */
  photos: number;
  created_at: string;
  /** What the coach proposes to add, in the state the person left each. */
  suggestions: SuggestionView[];
  /** Up to three tap-to-answer replies to the coach's question. */
  options: string[];
  /** A record read from the photos, until it is saved. */
  read: DocumentReadView | null;
  saved_document_id: string | null;
}

export interface HealthChatView {
  messages: ChatMessageView[];
}

/** A marker beside the nutrient it relates to in the food log (design §5). */
export interface MarkerFoodView {
  trend: MarkerTrend;
  nutrient: {
    key: MarkerNutrient;
    unit: "g" | "mg" | "ug";
    /** Monthly averages over the days logged, oldest first. */
    months: { month: string; average: number; days: number }[];
    /** The foods behind most of it in the last 90 days, largest first, with their share of the total. */
    sources: { name: string; share: number }[];
  } | null;
}

/** Nutrients a marker is shown beside: two of the food items' columns, or a vitamin or mineral the coach estimates. */
export type MarkerNutrient = "saturated_fat_g" | "added_sugars_g" | "iron_mg" | "vitamin_d_ug" | "vitamin_b12_ug" | "folate_ug";

export const MARKER_NUTRIENT: Readonly<Partial<Record<LabMarker, MarkerNutrient>>> = {
  ldl: "saturated_fat_g",
  total_cholesterol: "saturated_fat_g",
  hba1c: "added_sugars_g",
  glucose: "added_sugars_g",
  triglycerides: "added_sugars_g",
  ferritin: "iron_mg",
  iron: "iron_mg",
  haemoglobin: "iron_mg",
  vitamin_d: "vitamin_d_ug",
  b12: "vitamin_b12_ug",
  folate: "folate_ug",
};
