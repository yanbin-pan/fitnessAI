import { describe, expect, it } from "vitest";
import { ACTIVITIES } from "../src/vocab.ts";

describe("ACTIVITIES", () => {
  it("lists 33 activities once each: the owner's four first, other last", () => {
    expect(ACTIVITIES).toHaveLength(33);
    expect(new Set(ACTIVITIES).size).toBe(33);
    expect(ACTIVITIES.slice(0, 4)).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
    expect(ACTIVITIES[ACTIVITIES.length - 1]).toBe("other");
    for (const activity of ACTIVITIES) expect(activity).toMatch(/^[a-z_]+$/);
  });
});
