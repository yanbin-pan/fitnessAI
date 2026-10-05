import { describe, expect, it } from "vitest";
import { dayAndMonth, daySubtitle, failureText, monthTitle, thousands } from "./format.ts";

describe("failureText", () => {
  it("explains every code the server can record", () => {
    const codes = ["timeout", "ai_error", "ai_rate_limited", "ai_cap", "refused", "max_tokens", "tool_loop_limit", "ai_unavailable", "no_profile", "interrupted"];
    const texts = codes.map((code) => failureText(code));
    expect(texts).not.toContain("Something went wrong.");
    expect(new Set(texts).size).toBe(codes.length);
    expect(failureText("ai_cap")).toBe("Today's coach limit is used up. You can still add things by hand.");
    expect(failureText("internal")).toBe("Something went wrong.");
  });

  it("falls back for null, unknown codes and names every object inherits", () => {
    for (const code of [null, "constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(failureText(code)).toBe("Something went wrong.");
    }
  });
});

describe("calendar wording", () => {
  it("puts the date in words under Today and Yesterday, and the year under an older day", () => {
    expect(daySubtitle("2026-10-04", "2026-10-04")).toBe("Sun 4 Oct");
    expect(daySubtitle("2026-10-03", "2026-10-04")).toBe("Sat 3 Oct");
    expect(daySubtitle("2026-09-28", "2026-10-04")).toBe("2026");
  });

  it("names a month, a day and a big number the way the calendar reads them", () => {
    expect(monthTitle("2026-10")).toBe("October 2026");
    expect(dayAndMonth("2026-10-03")).toBe("3 October");
    expect(thousands(2363.4)).toBe("2,363");
  });
});
