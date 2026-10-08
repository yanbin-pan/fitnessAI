import { describe, expect, it } from "vitest";
import { alcoholStatus, alcoholWeek, isDrink } from "../src/alcohol.ts";
import type { DrinkLike } from "../src/alcohol.ts";
import { addMonths } from "../src/dates.ts";

const pint: DrinkLike = { drink: "beer", alcohol_units: 2.3, kcal: 200 };
const glass: DrinkLike = { drink: "wine", alcohol_units: 2.3, kcal: 160 };
const toast: DrinkLike = { drink: null, alcohol_units: 0, kcal: 90 };

describe("alcoholWeek", () => {
  it("is null when none of the 7 days ending on the day has a drink", () => {
    expect(alcoholWeek("2026-10-08", () => [toast])).toBeNull();
    // A drink 7 days back is outside the week.
    expect(alcoholWeek("2026-10-08", (date) => (date === "2026-10-01" ? [pint] : []))).toBeNull();
  });

  it("sums the units of the 7 days, oldest first, and counts the alcohol-free days", () => {
    const log: Record<string, DrinkLike[]> = {
      "2026-10-03": [pint, pint, glass],
      "2026-10-06": [pint],
      "2026-10-08": [pint, pint, glass, toast],
    };
    const week = alcoholWeek("2026-10-08", (date) => log[date] ?? []);
    expect(week).toMatchObject({ units: 16.1, status: "over", alcohol_free_days: 4 });
    expect(week?.days.map((d) => d.date)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(week?.days.map((d) => d.units)).toEqual([0, 6.9, 0, 0, 2.3, 0, 6.9]);
    expect(week?.drinks).toEqual([
      { drink: "beer", count: 5, units: 11.5, kcal: 1000 },
      { drink: "wine", count: 2, units: 4.6, kcal: 320 },
    ]);
  });

  it("counts a drink with alcohol but no kind, after the kinds", () => {
    const week = alcoholWeek("2026-10-08", () => [{ alcohol_units: 1, kcal: 60 }, { drink: "cocktail", alcohol_units: 2, kcal: 180 }]);
    expect(week?.drinks.map((d) => d.drink)).toEqual(["cocktail", null]);
  });
});

describe("alcohol helpers", () => {
  it("reads a drink by its kind or its alcohol", () => {
    expect(isDrink(pint)).toBe(true);
    expect(isDrink({ alcohol_units: 1.5, kcal: 100 })).toBe(true);
    expect(isDrink(toast)).toBe(false);
  });

  it("judges the week against the 14-unit guide", () => {
    expect(alcoholStatus(4.6)).toBe("within");
    expect(alcoholStatus(10.5)).toBe("near");
    expect(alcoholStatus(14)).toBe("near");
    expect(alcoholStatus(14.1)).toBe("over");
  });

  it("adds calendar months, keeping to the end of a shorter month", () => {
    expect(addMonths("2026-10-08", 3)).toBe("2027-01-08");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29");
  });
});
