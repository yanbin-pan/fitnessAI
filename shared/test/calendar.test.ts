import { describe, expect, it } from "vitest";
import { calorieStatus } from "../src/calendar.ts";

describe("calorieStatus", () => {
  it("losing or maintaining: within at or under the target, near up to 10 % over, off beyond", () => {
    for (const goal of ["lose", "maintain"] as const) {
      expect(calorieStatus(1200, 2320, goal)).toBe("within");
      expect(calorieStatus(2320, 2320, goal)).toBe("within");
      expect(calorieStatus(2321, 2320, goal)).toBe("near");
      expect(calorieStatus(2552, 2320, goal)).toBe("near"); // exactly 10 % over
      expect(calorieStatus(2553, 2320, goal)).toBe("off");
    }
  });

  it("gaining: within at or over the target, near up to 10 % under, off beyond", () => {
    expect(calorieStatus(3400, 3000, "gain")).toBe("within");
    expect(calorieStatus(3000, 3000, "gain")).toBe("within");
    expect(calorieStatus(2999, 3000, "gain")).toBe("near");
    expect(calorieStatus(2700, 3000, "gain")).toBe("near"); // exactly 10 % under
    expect(calorieStatus(2699, 3000, "gain")).toBe("off");
  });

  it("compares the numbers as the app shows them: eaten to the kcal, the target to 10", () => {
    expect(calorieStatus(2320.4, 2316, "lose")).toBe("within"); // 2320 of a target shown as 2320
    expect(calorieStatus(2320.5, 2324, "lose")).toBe("near"); // 2321 of a target shown as 2320
  });
});
