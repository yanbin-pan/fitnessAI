import type { Micro } from "./vocab.ts";

// Tips from the companion (2026-10-23 pet tips design): short ways to use the app that aren't obvious, one at a time.
// The pet glows while one is waiting; a tap puts it in the chat. Each tip is shown once, ever, at most two a day, and once
// every tip has been seen the pet never glows for them again.

/** In the order they are offered; a tip whose moment hasn't come (a gap to close, a low vitamin) is passed over until it has. */
export const TIP_IDS = [
  "shared-plate", "close-day", "menu-photo", "vitamin-gaps", "plan-ahead", "several-photos", "same-again", "fix-by-talking",
  "training", "paste-screenshot", "log-past-day", "log-only", "drinks", "blood-tests", "hold-to-peek", "coach-tone",
] as const;
export type TipId = (typeof TIP_IDS)[number];

/** At most this many tips a day. */
export const MAX_TIPS_PER_DAY = 2;
/** Before this local hour only the first of the day's tips; from it, the second. */
export const SECOND_TIP_HOUR = 14;
/** The nutrients a vitamin tip names, at most. */
export const MAX_TIP_NUTRIENTS = 3;

/** The day's numbers a tip was shown with, kept so it reads the same later in the day. */
export interface TipVars {
  kcal?: number;
  protein_g?: number;
  nutrients?: Micro[];
}

/** A tip that has been shown: the local day, the moment, and its numbers. */
export interface SeenTip {
  id: TipId;
  date: string;
  seen_at: string;
  vars: TipVars;
}

/** What GET and POST /api/tips answer: every tip shown so far, oldest first. */
export interface TipsView {
  tips: SeenTip[];
}

/** How many tips the day may have had by `hour` (local, 0–23). */
export function tipsAllowedBy(hour: number): number {
  return hour < SECOND_TIP_HOUR ? 1 : MAX_TIPS_PER_DAY;
}
