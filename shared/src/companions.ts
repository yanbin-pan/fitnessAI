import { ALCOHOL_WEEK_GUIDE } from "./alcohol.ts";
import type { DaySummary } from "./api.ts";
import { addDays } from "./dates.ts";

// How the companion feels (2026-10-08 companions design §3): from the average of the last 7 fully logged days' eaten kcal
// against their adjusted targets, never from a single day. Missed days and days logged too thinly to be true are skipped,
// so a forgotten dinner does not starve the companion.

export const COMPANION_MOODS = ["inactive", "sluggish", "okay", "thriving", "overfed"] as const;
export type CompanionMood = (typeof COMPANION_MOODS)[number];

/** The rolling average's window. A week with nothing logged in it, today included, puts the companion to sleep. */
export const COMPANION_WINDOW_DAYS = 7;
/** A day counts towards the average only with at least this share of its target logged; below it, the log is incomplete. */
export const COMPANION_COMPLETE_SHARE = 1 / 3;
/** How far back, from the day before today, the average looks for its 7 fully logged days. */
export const COMPANION_SEARCH_DAYS = 28;
/** Within this share of the target either way the week is Okay; beyond it, Sluggish (under) or Overfed (over). */
export const COMPANION_TOLERANCE = 0.15;
/** Days in a row with an Okay week that make Thriving. */
export const COMPANION_THRIVE_DAYS = 14;
/** A day's average counts towards Thriving only with this many fully logged days in its own calendar week: Okay needs logging. */
export const COMPANION_STREAK_MIN_LOGGED = 4;
/** How far back the days must go: the oldest average the streak looks at searches back to this many days before today. */
export const COMPANION_LOOKBACK_DAYS = COMPANION_THRIVE_DAYS + COMPANION_SEARCH_DAYS - 1;

/** What the app shows about the companion: the mood and the numbers behind it. */
export interface CompanionStatus {
  mood: CompanionMood;
  /** The average day of the last 7 fully logged days before today, within COMPANION_SEARCH_DAYS; null when there is none. */
  avg_kcal: number | null;
  avg_target_kcal: number | null;
  /** How many fully logged days that average is of, up to 7. */
  days_logged: number;
  /** Days in a row, ending yesterday, whose week was Okay with enough days logged, up to COMPANION_THRIVE_DAYS. */
  okay_streak: number;
  /** Alcohol units of the 7 days ending today, today included, as the drinks pill counts them. */
  alcohol_units: number;
  /** Over the weekly guide: the woozy layer on top of any awake mood (2026-10-08 companions design §3). */
  over_alcohol: boolean;
}

type WeekBalance = "under" | "okay" | "over";

/** Whether a day was logged fully enough to be believed: at least a third of its target, or anything without a target. */
function isComplete(day: DaySummary): boolean {
  return day.target_kcal > 0 ? day.kcal >= day.target_kcal * COMPANION_COMPLETE_SHARE : day.kcal > 0;
}

/**
 * The average day of the last 7 fully logged days up to `end`, looking back COMPANION_SEARCH_DAYS at most. `recent` is how
 * many of them fall in the 7 calendar days ending on `end`.
 */
function week(byDate: Map<string, DaySummary>, end: string) {
  let kcal = 0;
  let target = 0;
  let logged = 0;
  let recent = 0;
  for (let i = 0; i < COMPANION_SEARCH_DAYS && logged < COMPANION_WINDOW_DAYS; i++) {
    const day = byDate.get(addDays(end, -i));
    if (!day || !isComplete(day)) continue;
    kcal += day.kcal;
    target += day.target_kcal;
    logged += 1;
    if (i < COMPANION_WINDOW_DAYS) recent += 1;
  }
  return logged === 0 ? null : { kcal: kcal / logged, target: target / logged, logged, recent };
}

function balanceOf(avg: { kcal: number; target: number }): WeekBalance {
  if (avg.target <= 0) return "okay";
  const ratio = avg.kcal / avg.target;
  if (ratio < 1 - COMPANION_TOLERANCE) return "under";
  if (ratio > 1 + COMPANION_TOLERANCE) return "over";
  return "okay";
}

/**
 * The companion's mood on `today` from the days with food logged (the calendar's summaries), which must reach back
 * COMPANION_LOOKBACK_DAYS days. Today is still in progress, so the average is of the fully logged days before it; but
 * logging anything today wakes a sleeping companion. `alcoholUnits` are the 7 days ending today: over the guide adds the layer.
 */
export function companionStatus(days: readonly DaySummary[], today: string, alcoholUnits = 0): CompanionStatus {
  return { ...moodOf(days, today), alcohol_units: alcoholUnits, over_alcohol: alcoholUnits > ALCOHOL_WEEK_GUIDE };
}

function moodOf(days: readonly DaySummary[], today: string): Omit<CompanionStatus, "alcohol_units" | "over_alcohol"> {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const yesterday = addDays(today, -1);
  const current = week(byDate, yesterday);
  const base = {
    avg_kcal: current ? Math.round(current.kcal) : null,
    avg_target_kcal: current ? Math.round(current.target) : null,
    days_logged: current?.logged ?? 0,
  };
  if (!hasLoggedSince(byDate, addDays(today, -(COMPANION_WINDOW_DAYS - 1)), today)) return { mood: "inactive", ...base, okay_streak: 0 };
  // Only today or thin days logged so far: awake, and nothing to judge yet.
  if (!current) return { mood: "okay", ...base, okay_streak: 0 };
  const balance = balanceOf(current);
  if (balance !== "okay") return { mood: balance === "under" ? "sluggish" : "overfed", ...base, okay_streak: 0 };
  let streak = 0;
  while (streak < COMPANION_THRIVE_DAYS) {
    const avg = week(byDate, addDays(yesterday, -streak));
    if (!avg || avg.recent < COMPANION_STREAK_MIN_LOGGED || balanceOf(avg) !== "okay") break;
    streak += 1;
  }
  return { mood: streak >= COMPANION_THRIVE_DAYS ? "thriving" : "okay", ...base, okay_streak: streak };
}

/** Whether any day from `from` to `to`, both included, has food logged. */
function hasLoggedSince(byDate: Map<string, DaySummary>, from: string, to: string): boolean {
  for (let day = from; day <= to; day = addDays(day, 1)) if (byDate.has(day)) return true;
  return false;
}
