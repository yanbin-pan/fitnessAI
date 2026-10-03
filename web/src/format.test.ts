import { describe, expect, it } from "vitest";
import { failureText } from "./format.ts";

describe("failureText", () => {
  it("explains every code the server can record", () => {
    const codes = ["timeout", "ai_error", "ai_rate_limited", "refused", "max_tokens", "tool_loop_limit", "ai_unavailable", "no_profile", "interrupted"];
    const texts = codes.map((code) => failureText(code));
    expect(texts).not.toContain("Something went wrong.");
    expect(new Set(texts).size).toBe(codes.length);
    expect(failureText("internal")).toBe("Something went wrong.");
  });

  it("falls back for null, unknown codes and names every object inherits", () => {
    for (const code of [null, "ai_cap", "constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(failureText(code)).toBe("Something went wrong.");
    }
  });
});
