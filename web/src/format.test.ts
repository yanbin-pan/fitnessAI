import { describe, expect, it } from "vitest";
import { dayAndMonth, dayLabel, daySubtitle, failureText, monthTitle, thousands } from "./format.ts";
import { MESSAGES, en } from "./i18n/index.tsx";

describe("failureText", () => {
  it("explains every code the server can record", () => {
    const codes = ["timeout", "ai_error", "ai_rate_limited", "ai_cap", "refused", "max_tokens", "tool_loop_limit", "ai_unavailable", "no_profile", "interrupted"];
    const texts = codes.map((code) => failureText(code, en));
    expect(texts).not.toContain("Something went wrong.");
    expect(new Set(texts).size).toBe(codes.length);
    expect(failureText("ai_cap", en)).toBe("Today's coach limit is used up. You can still add things by hand.");
    expect(failureText("internal", en)).toBe("Something went wrong.");
  });

  it("falls back for null, unknown codes and names every object inherits", () => {
    for (const code of [null, "constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(failureText(code, en)).toBe("Something went wrong.");
    }
  });
});

describe("calendar wording", () => {
  it("puts the date in words under Today and Yesterday, and the year under an older day", () => {
    expect(daySubtitle("2026-10-04", "2026-10-04", en)).toBe("Sun 4 Oct");
    expect(daySubtitle("2026-10-03", "2026-10-04", en)).toBe("Sat 3 Oct");
    expect(daySubtitle("2026-09-28", "2026-10-04", en)).toBe("2026");
  });

  it("names a month, a day and a big number the way the calendar reads them", () => {
    expect(monthTitle("2026-10", en)).toBe("October 2026");
    expect(dayAndMonth("2026-10-03", en)).toBe("3 October");
    expect(thousands(2363.4, en)).toBe("2,363");
  });
});

describe("in the chosen language", () => {
  it("writes dates, numbers and the failure reasons in that language", () => {
    expect(dayLabel("2026-10-04", "2026-10-04", MESSAGES.it)).toBe("Oggi");
    expect(dayLabel("2026-10-03", "2026-10-04", MESSAGES.de)).toBe("Gestern");
    expect(monthTitle("2026-10", MESSAGES.fr)).toBe("octobre 2026");
    expect(monthTitle("2026-10", MESSAGES.zh)).toBe("2026年10月");
    expect(dayAndMonth("2026-10-03", MESSAGES.es)).toBe("3 de octubre");
    expect(thousands(2363.4, MESSAGES.de)).toBe("2.363");
    expect(failureText("ai_cap", MESSAGES.lt)).toBe(MESSAGES.lt.failures.ai_cap);
    expect(failureText("constructor", MESSAGES.zh)).toBe("出错了。");
  });
});
