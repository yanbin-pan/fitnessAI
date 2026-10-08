import { ALCOHOL_WEEK_GUIDE } from "./alcohol.ts";
import type { DaySummary } from "./api.ts";
import { addDays } from "./dates.ts";

// How the companion feels (2026-10-08 companions design §3): from the rolling 7-day average of eaten kcal against the
// days' adjusted targets, never from a single day.

export const COMPANION_MOODS = ["inactive", "sluggish", "okay", "thriving", "overfed"] as const;
export type CompanionMood = (typeof COMPANION_MOODS)[number];

/** The rolling average's window. A week with nothing logged in it, today included, puts the companion to sleep. */
export const COMPANION_WINDOW_DAYS = 7;
/** Within this share of the target either way the week is Okay; beyond it, Sluggish (under) or Overfed (over). */
export const COMPANION_TOLERANCE = 0.15;
/** Days in a row with an Okay week that make Thriving. */
export const COMPANION_THRIVE_DAYS = 14;
/** A week counts towards Thriving only with food logged on at least this many of its days: an Okay week needs logging. */
export const COMPANION_STREAK_MIN_LOGGED = 4;
/** How far back the days must go: the oldest week the streak looks at starts this many days before today. */
export const COMPANION_LOOKBACK_DAYS = COMPANION_THRIVE_DAYS + COMPANION_WINDOW_DAYS - 1;

/** What the app shows about the companion: the mood and the numbers behind it. */
export interface CompanionStatus {
  mood: CompanionMood;
  /** The average day of the 7 complete days before today, counting only days with food logged; null when none has. */
  avg_kcal: number | null;
  avg_target_kcal: number | null;
  /** Days with food logged among those 7. */
  days_logged: number;
  /** Days in a row, ending yesterday, whose week was Okay with enough days logged, up to COMPANION_THRIVE_DAYS. */
  okay_streak: number;
  /** Alcohol units of the 7 days ending today, today included, as the drinks pill counts them. */
  alcohol_units: number;
  /** Over the weekly guide: the woozy layer on top of any awake mood (2026-10-08 companions design §3). */
  over_alcohol: boolean;
}

type WeekBalance = "under" | "okay" | "over";

/** The average day of the 7 ending on `end`, from the days with food logged among them. */
function week(byDate: Map<string, DaySummary>, end: string) {
  let kcal = 0;
  let target = 0;
  let logged = 0;
  for (let i = 0; i < COMPANION_WINDOW_DAYS; i++) {
    const day = byDate.get(addDays(end, -i));
    if (!day) continue;
    kcal += day.kcal;
    target += day.target_kcal;
    logged += 1;
  }
  return logged === 0 ? null : { kcal: kcal / logged, target: target / logged, logged };
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
 * COMPANION_LOOKBACK_DAYS days. Today is still in progress, so the average is of the 7 days before it; but logging
 * anything today wakes a sleeping companion. `alcoholUnits` are the 7 days ending today: over the guide adds the layer.
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
  // Only today logged so far: awake, and nothing to judge yet.
  if (!current) return { mood: "okay", ...base, okay_streak: 0 };
  const balance = balanceOf(current);
  if (balance !== "okay") return { mood: balance === "under" ? "sluggish" : "overfed", ...base, okay_streak: 0 };
  let streak = 0;
  while (streak < COMPANION_THRIVE_DAYS) {
    const avg = week(byDate, addDays(yesterday, -streak));
    if (!avg || avg.logged < COMPANION_STREAK_MIN_LOGGED || balanceOf(avg) !== "okay") break;
    streak += 1;
  }
  return { mood: streak >= COMPANION_THRIVE_DAYS ? "thriving" : "okay", ...base, okay_streak: streak };
}

/** Whether any day from `from` to `to`, both included, has food logged. */
function hasLoggedSince(byDate: Map<string, DaySummary>, from: string, to: string): boolean {
  for (let day = from; day <= to; day = addDays(day, 1)) if (byDate.has(day)) return true;
  return false;
}
