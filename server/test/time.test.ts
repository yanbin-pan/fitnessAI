import { describe, expect, it } from "vitest";
import { localDate, localTime, todayIn, weekdayName, zonedTimeToInstant } from "../src/time.ts";

const LONDON = "Europe/London";
const at = (iso: string) => new Date(iso);

describe("localDate", () => {
  it("uses the wall clock of the timezone, not UTC", () => {
    expect(localDate(at("2026-03-28T23:30:00Z"), LONDON)).toBe("2026-03-28"); // GMT
    expect(localDate(at("2026-06-30T23:30:00Z"), LONDON)).toBe("2026-07-01"); // BST: already 00:30
    expect(localDate(at("2026-10-24T23:30:00Z"), LONDON)).toBe("2026-10-25"); // still BST
    expect(localDate(at("2026-10-25T23:30:00Z"), LONDON)).toBe("2026-10-25"); // back on GMT
  });
});

describe("localTime and weekdayName", () => {
  it("format the local wall clock", () => {
    expect(localTime(at("2026-07-01T07:10:00Z"), LONDON)).toBe("08:10");
    expect(localTime(at("2026-06-30T23:05:00Z"), LONDON)).toBe("00:05");
    expect(weekdayName(at("2026-10-03T12:00:00Z"), LONDON)).toBe("Saturday");
    expect(todayIn(LONDON, at("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("zonedTimeToInstant", () => {
  it("finds the UTC instant for a local date and time", () => {
    expect(zonedTimeToInstant("2026-07-01", "08:10", LONDON).toISOString()).toBe("2026-07-01T07:10:00.000Z");
    expect(zonedTimeToInstant("2026-12-01", "08:10", LONDON).toISOString()).toBe("2026-12-01T08:10:00.000Z");
    expect(zonedTimeToInstant("2026-07-01", "08:10", "America/New_York").toISOString()).toBe("2026-07-01T12:10:00.000Z");
  });
});
