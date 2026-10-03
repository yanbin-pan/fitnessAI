import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isIsoDate } from "../src/dates.ts";

describe("isIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isIsoDate("2026-10-03")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-01", "03/10/2026", "", "2026-10-03T00:00"]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-03", -7)).toBe("2026-09-26");
  });

  it("refuses something that is not a date", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("daysBetween", () => {
  it("counts whole days from the first date to the second", () => {
    expect(daysBetween("2026-10-01", "2026-10-03")).toBe(2);
    expect(daysBetween("2026-10-03", "2026-10-01")).toBe(-2);
    // Across the March clock change: calendar days, not 24-hour periods.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});
