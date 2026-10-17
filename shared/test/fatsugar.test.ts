import { describe, expect, it } from "vitest";
import { fatSugarDay } from "../src/fatsugar.ts";

const food = (fat_g: number, saturated_fat_g: number, sugars_g: number, added_sugars_g: number | null) => ({ fat_g, saturated_fat_g, sugars_g, added_sugars_g });

describe("fatSugarDay", () => {
  it("splits the fat into unsaturated and saturated and sums the free sugars", () => {
    expect(fatSugarDay([food(14, 8.5, 6, 5), food(28, 5, 5, 0), food(0, 0, 18, 18)])).toEqual({
      fat_g: 42, saturated_fat_g: 13.5, unsaturated_fat_g: 28.5, sugars_g: 29, added_sugars_g: 23, unestimated: 0,
    });
  });

  it("has no added sugar on a day logged before it was estimated, and counts the items without it on a mixed day", () => {
    expect(fatSugarDay([food(10, 2, 4, null)]).added_sugars_g).toBeNull();
    expect(fatSugarDay([food(10, 2, 4, null), food(1, 0, 20, 20)])).toMatchObject({ added_sugars_g: 20, unestimated: 1 });
    expect(fatSugarDay([])).toMatchObject({ fat_g: 0, added_sugars_g: null, unestimated: 0 });
  });

  it("never reports negative unsaturated fat", () => {
    expect(fatSugarDay([food(5, 6, 0, 0)]).unsaturated_fat_g).toBe(0);
  });
});
