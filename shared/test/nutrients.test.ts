import { describe, expect, it } from "vitest";
import { MICROS, MICRO_REFERENCE, nutrientSignals } from "../src/index.ts";
import type { Micro, SignalDay } from "../src/index.ts";

/** A day of 2000 kcal whose foods all carry estimates, with each micro at `share` of its reference. */
function day(overrides: Partial<SignalDay> = {}, share = 1): SignalDay {
  const micros = Object.fromEntries(MICROS.map((m) => [m, MICRO_REFERENCE[m].male * share])) as Record<Micro, number>;
  return { kcal: 2000, fat_g: 70, saturated_fat_g: 20, sugars_g: 70, salt_g: 5, micros, micros_kcal: 2000, ...overrides };
}

describe("nutrientSignals", () => {
  it("judges nothing from a single day", () => {
    expect(nutrientSignals([day()], "male")).toEqual({ days: 1, levels: {} });
  });

  it("reads a balanced few days as on point across the board", () => {
    const { days, levels } = nutrientSignals([day(), day(), day()], "male");
    expect(days).toBe(3);
    expect(levels).toMatchObject({ unsaturated_fat: "ok", saturated_fat: "ok", sugars: "ok", salt: "ok", vitamin_c_mg: "ok", iron_mg: "ok" });
    expect(Object.keys(levels)).toHaveLength(15);
  });

  it("calls out a lot of saturated fat, sugar and salt, and little unsaturated fat", () => {
    const heavy = day({ fat_g: 100, saturated_fat_g: 60, sugars_g: 150, salt_g: 9 });
    expect(nutrientSignals([heavy, heavy], "male").levels).toMatchObject({ unsaturated_fat: "low", saturated_fat: "high", sugars: "high", salt: "high" });
  });

  it("reads vitamins and minerals as low or stacked against the reference", () => {
    expect(nutrientSignals([day({}, 0.3), day({}, 0.3)], "male").levels.vitamin_c_mg).toBe("low");
    expect(nutrientSignals([day({}, 2), day({}, 2)], "male").levels.vitamin_c_mg).toBe("high");
  });

  it("uses the reference for the person's sex", () => {
    const iron = (amount: number) => day({ micros: { iron_mg: amount } });
    expect(nutrientSignals([iron(9), iron(9)], "male").levels.iron_mg).toBe("ok");
    expect(nutrientSignals([iron(9), iron(9)], "female").levels.iron_mg).toBe("low");
  });

  it("scales estimates up when some foods have none, and judges no micros when too few do", () => {
    // Estimates cover 1500 of 2000 kcal: 60 mg of vitamin C over three quarters reads as 80 mg for the day.
    const partial = day({ micros: { vitamin_c_mg: 60 }, micros_kcal: 1500 });
    expect(nutrientSignals([partial, partial], "male").levels.vitamin_c_mg).toBe("ok");
    const sparse = day({ micros: { vitamin_c_mg: 60 }, micros_kcal: 500 });
    const levels = nutrientSignals([sparse, sparse], "male").levels;
    expect(levels.vitamin_c_mg).toBeUndefined();
    expect(levels.salt).toBe("ok"); // fats, sugar and salt never depend on the estimates
  });
});
