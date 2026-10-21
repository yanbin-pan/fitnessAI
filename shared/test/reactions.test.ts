import { describe, expect, it } from "vitest";
import { asReaction, splitReaction } from "../src/reactions.ts";

describe("splitReaction", () => {
  it("takes the tag off the start of the reply", () => {
    expect(splitReaction("[react:👍] Logged 2 eggs, 180 kcal.")).toEqual({ reaction: "👍", text: "Logged 2 eggs, 180 kcal." });
    expect(splitReaction("  [react: 🤔 ]\nA third croissant?")).toEqual({ reaction: "🤔", text: "A third croissant?" });
  });

  it("matches a heart with or without its variation selector", () => {
    expect(splitReaction("[react:❤]Nice").reaction).toBe("❤️");
    expect(asReaction("❤️")).toBe("❤️");
  });

  it("hides a tag with an emoji outside the list, but gives no reaction", () => {
    expect(splitReaction("[react:💩] Logged.")).toEqual({ reaction: null, text: "Logged." });
  });

  it("leaves a reply without a tag, or with one further in, as it is", () => {
    expect(splitReaction("Logged.")).toEqual({ reaction: null, text: "Logged." });
    expect(splitReaction("Logged [react:👍]")).toEqual({ reaction: null, text: "Logged [react:👍]" });
  });
});
