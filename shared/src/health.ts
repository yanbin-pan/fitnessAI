// The Health tab (2026-10-12 health context design): conditions, medications and blood results the person adds, which
// the coach reads as context. Kept free of Zod so the web app can import the vocabularies at runtime.

/** Conditions, diets and sensitivities offered as chips, grouped as the tab shows them; `other` takes a label. */
export const HEALTH_CONDITIONS = [
  "vegetarian", "vegan", "halal", "kosher",
  "nut_allergy", "lactose_intolerance", "coeliac", "shellfish_allergy",
  "high_cholesterol", "prediabetes", "type2_diabetes", "high_blood_pressure",
  "ibs", "reflux",
  "pregnant", "breastfeeding", "menopause",
  "eating_disorder_history",
  "other",
] as const;
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number];

/**
 * Blood markers the coach knows by a fixed code, so trends never split across a lab's spellings. Anything else on a
 * report is kept under `other` with its printed name.
 */
export const LAB_MARKERS = [
  "total_cholesterol", "ldl", "hdl", "triglycerides",
  "glucose", "hba1c",
  "ferritin", "iron", "haemoglobin", "b12", "folate", "vitamin_d",
  "tsh", "creatinine", "egfr", "alt", "ast", "crp",
  "other",
] as const;
export type LabMarker = (typeof LAB_MARKERS)[number];

/** Where a value sits against the lab's own reference range; `unknown` when the report gives none. */
export type LabFlag = "low" | "normal" | "high" | "unknown";

export const MAX_LAB_RESULTS = 80;
export const MAX_LAB_PHOTOS = 4;

/** The flag of a value against a range, either end of which may be missing. */
export function labFlag(value: number, low: number | null, high: number | null): LabFlag {
  if (low === null && high === null) return "unknown";
  if (low !== null && value < low) return "low";
  if (high !== null && value > high) return "high";
  return "normal";
}

export interface ConditionView {
  id: string;
  kind: HealthCondition;
  /** The chip's own words for `other`; null for the fixed ones, which the app names in the person's language. */
  label: string | null;
  added_at: string;
}

export interface MedicationView {
  id: string;
  name: string;
  /** As the person writes it ("20 mg once a day"); empty when not given. */
  dose: string;
  started_on: string | null;
  /** Null while they still take it. */
  stopped_on: string | null;
}

export interface LabResultView {
  id: string;
  marker: LabMarker;
  /** As printed on the report. */
  name: string;
  value: number;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  flag: LabFlag;
}

export interface LabReportView {
  id: string;
  taken_on: string;
  lab_name: string;
  results: LabResultView[];
}

/** One marker across reports, newest last, for its trend: only results in the latest one's unit, so they compare. */
export interface MarkerTrend {
  key: string;
  marker: LabMarker;
  name: string;
  unit: string;
  points: { taken_on: string; value: number; flag: LabFlag }[];
  ref_low: number | null;
  ref_high: number | null;
}

export interface HealthView {
  /** When the person agreed to keep health records and share them with the coach; null until they do. */
  consented_at: string | null;
  conditions: ConditionView[];
  medications: MedicationView[];
  /** Newest first. */
  reports: LabReportView[];
  trends: MarkerTrend[];
}

/** What Claude read from photos of a lab report, for the person to check before anything is saved. */
export interface LabReadView {
  taken_on: string | null;
  lab_name: string;
  results: { marker: LabMarker; name: string; value: number; unit: string; ref_low: number | null; ref_high: number | null }[];
}
