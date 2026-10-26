import { describe, expect, it } from "vitest";
import { COMPANION_LOOKBACK_DAYS, companionStatus } from "../src/companions.ts";
import type { DaySummary } from "../src/api.ts";
import { addDays } from "../src/dates.ts";

const TODAY = "2026-10-21";

/** Days `from` to `to` days before today, each eating `kcal` of a 2000 target. */
function run(from: number, to: number, kcal: number): DaySummary[] {
  const out: DaySummary[] = [];
  for (let back = from; back >= to; back--) out.push({ date: addDays(TODAY, -back), kcal, target_kcal: 2000 });
  return out;
}

describe("companionStatus", () => {
  it("is asleep when nothing was logged in the 7 days ending today", () => {
    expect(companionStatus([], TODAY)).toMatchObject({ mood: "inactive", avg_kcal: null, days_logged: 0 });
    // The last meal was 7 days ago: a whole week without anything.
    expect(companionStatus(run(20, 7, 2000), TODAY).mood).toBe("inactive");
    expect(companionStatus(run(20, 6, 2000), TODAY).mood).toBe("okay");
  });

  it("wakes up as soon as something is logged today, with nothing to judge yet", () => {
    expect(companionStatus(run(0, 0, 500), TODAY)).toMatchObject({ mood: "okay", avg_kcal: null, okay_streak: 0 });
  });

  it("averages the last 7 fully logged days before today, leaving out today and the days with nothing logged", () => {
    const days = [...run(12, 12, 9000), ...run(9, 7, 1000), ...run(5, 4, 1000), ...run(2, 1, 1400), ...run(0, 0, 9000)];
    // 1000 × 5 and 1400 × 2, reaching back past the missed days: 1114 of 2000, 56 %. The feast 12 days ago is an 8th day.
    expect(companionStatus(days, TODAY)).toMatchObject({ mood: "sluggish", avg_kcal: 1114, avg_target_kcal: 2000, days_logged: 7 });
  });

  it("skips days logged at under a third of their target, as forgotten rather than starved", () => {
    // A week on target with three thin days in it (a snack, a forgotten dinner): still Okay, from the four real days.
    const days = [...run(7, 4, 2000), ...run(3, 1, 400)];
    expect(companionStatus(days, TODAY)).toMatchObject({ mood: "okay", avg_kcal: 2000, days_logged: 4 });
    // Exactly a third counts.
    expect(companionStatus(run(7, 1, 667), TODAY)).toMatchObject({ mood: "sluggish", days_logged: 7 });
    expect(companionStatus(run(7, 1, 666), TODAY)).toMatchObject({ mood: "okay", avg_kcal: null, days_logged: 0 });
  });

  it("looks back up to 28 days for 7 fully logged days, and stays neutral when there are none", () => {
    // Only thin days lately, but a steady fortnight before them: the companion follows the steady days.
    const days = [...run(20, 8, 2000), ...run(7, 1, 300)];
    expect(companionStatus(days, TODAY)).toMatchObject({ mood: "okay", avg_kcal: 2000, days_logged: 7 });
    // Nothing full within the 28 days before today: awake, with nothing to judge.
    expect(companionStatus([...run(29, 29, 2000), ...run(3, 1, 300)], TODAY)).toMatchObject({ mood: "okay", avg_kcal: null, okay_streak: 0 });
    expect(companionStatus([...run(28, 28, 2000), ...run(3, 1, 300)], TODAY)).toMatchObject({ avg_kcal: 2000, days_logged: 1 });
  });

  it("does not thrive on old days alone: Thriving needs 4 fully logged days in each week", () => {
    const days = [...run(COMPANION_LOOKBACK_DAYS, 8, 2000), ...run(7, 1, 300)];
    expect(companionStatus(days, TODAY)).toMatchObject({ mood: "okay", okay_streak: 0 });
  });

  it("is Okay within 15 % of the target either way, Sluggish below and Overfed above", () => {
    expect(companionStatus(run(7, 1, 1700), TODAY).mood).toBe("okay"); // exactly 15 % under
    expect(companionStatus(run(7, 1, 1699), TODAY).mood).toBe("sluggish");
    expect(companionStatus(run(7, 1, 2300), TODAY).mood).toBe("okay"); // exactly 15 % over
    expect(companionStatus(run(7, 1, 2301), TODAY).mood).toBe("overfed");
  });

  it("weighs each day against its own target", () => {
    const days: DaySummary[] = [
      { date: addDays(TODAY, -2), kcal: 3000, target_kcal: 3000 },
      { date: addDays(TODAY, -1), kcal: 1000, target_kcal: 1000 },
    ];
    expect(companionStatus(days, TODAY)).toMatchObject({ mood: "okay", avg_kcal: 2000, avg_target_kcal: 2000 });
  });

  it("does not move with a single day: one feast in an Okay week stays Okay", () => {
    const days = [...run(7, 2, 1900), ...run(1, 1, 3200)];
    expect(companionStatus(days, TODAY).mood).toBe("okay");
  });

  it("thrives once the week has been Okay on each of the last 7 days", () => {
    const steady = run(COMPANION_LOOKBACK_DAYS, 1, 2050);
    expect(companionStatus(steady, TODAY)).toMatchObject({ mood: "thriving", okay_streak: 7 });
    // The oldest of the 7 weeks needs 4 logged days of its own: history from 10 days back is just enough.
    expect(companionStatus(run(10, 1, 2050), TODAY)).toMatchObject({ mood: "thriving" });
    expect(companionStatus(run(9, 1, 2050), TODAY)).toMatchObject({ mood: "okay", okay_streak: 6 });
  });

  it("restarts the streak after a week that was off", () => {
    // Ten days ago a binge pushed every week that holds it over: the streak counts only the days since it left.
    const days = [...run(COMPANION_LOOKBACK_DAYS, 11, 2000), ...run(10, 10, 9000), ...run(9, 1, 2000)];
    const status = companionStatus(days, TODAY);
    expect(status.mood).toBe("okay");
    expect(status.okay_streak).toBe(3);
  });

  it("counts a week towards Thriving only with food logged on at least 4 of its days", () => {
    // Every other day, on target: each week holds 3 or 4 logged days, so the streak breaks on the first thin one.
    const alternate = run(COMPANION_LOOKBACK_DAYS, 1, 2000).filter((_, i) => i % 2 === 0);
    const status = companionStatus(alternate, TODAY);
    expect(status.mood).toBe("okay");
    expect(status.okay_streak).toBeLessThan(7);
    // Stopped logging 6 days ago: still awake, but the week no longer counts.
    expect(companionStatus(run(COMPANION_LOOKBACK_DAYS, 6, 2000), TODAY)).toMatchObject({ mood: "okay", okay_streak: 0 });
  });

  it("adds the alcohol layer over the 14-unit weekly guide, on top of whatever the mood is", () => {
    expect(companionStatus(run(7, 1, 2000), TODAY, 14)).toMatchObject({ mood: "okay", alcohol_units: 14, over_alcohol: false });
    expect(companionStatus(run(7, 1, 2000), TODAY, 14.1)).toMatchObject({ mood: "okay", over_alcohol: true });
    expect(companionStatus(run(7, 1, 3000), TODAY, 20)).toMatchObject({ mood: "overfed", over_alcohol: true });
    // The flag is set even while asleep; the avatar hides it then.
    expect(companionStatus([], TODAY, 20)).toMatchObject({ mood: "inactive", over_alcohol: true });
    expect(companionStatus(run(7, 1, 2000), TODAY)).toMatchObject({ alcohol_units: 0, over_alcohol: false });
  });
});
