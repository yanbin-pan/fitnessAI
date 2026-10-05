import { describe, expect, it } from "vitest";
import { midSentence, stepText } from "../src/coach/steps.ts";
import { TOOL_EGGS, TOOL_RUN, logItemsInput } from "./helpers.ts";

describe("stepText", () => {
  it("starts by thinking, or by looking at the photos, and writes a reply after the tools", () => {
    expect(stepText({ kind: "start" }, 0)).toBe("Thinking…");
    expect(stepText({ kind: "start" }, 1)).toBe("Looking at your photo…");
    expect(stepText({ kind: "start" }, 3)).toBe("Looking at your photos…");
    expect(stepText({ kind: "reply" }, 2)).toBe("Writing a reply…");
  });

  it("names what it logs: up to three items, then how many more", () => {
    const log = (names: string[]) =>
      stepText({ kind: "tool", name: "log_items", input: logItemsInput({ foods: names.map((name) => ({ ...TOOL_EGGS, name })) }) }, 0);
    expect(log(["Fried eggs"])).toBe("Logging fried eggs…");
    expect(log(["Fried eggs", "Buttered toast"])).toBe("Logging fried eggs and buttered toast…");
    expect(log(["Fried eggs", "Buttered toast", "Baked beans"])).toBe("Logging fried eggs, buttered toast and baked beans…");
    expect(log(["Fried eggs", "Buttered toast", "Baked beans", "Tomato", "Coffee"])).toBe("Logging fried eggs, buttered toast, baked beans and 2 more…");
    const tennis = logItemsInput({ foods: [], exercises: [{ ...TOOL_RUN, name: "Tennis singles" }] });
    expect(stepText({ kind: "tool", name: "log_items", input: tennis }, 0)).toBe("Logging tennis singles…");
  });

  it("names the entry it updates", () => {
    const input = { entry_id: "e1", foods: [], exercises: [{ ...TOOL_RUN, name: "Tennis singles" }] };
    expect(stepText({ kind: "tool", name: "update_entry", input }, 0)).toBe("Updating tennis singles…");
  });

  it("says something general when a tool's input can't be read", () => {
    expect(stepText({ kind: "tool", name: "log_items", input: { nonsense: true } }, 0)).toBe("Logging…");
    expect(stepText({ kind: "tool", name: "update_entry", input: null }, 0)).toBe("Updating your log…");
    expect(stepText({ kind: "tool", name: "something_new", input: {} }, 0)).toBe("Working…");
  });
});

describe("stepText in the chosen language", () => {
  const log = (names: string[], language: Parameters<typeof stepText>[2]) =>
    stepText({ kind: "tool", name: "log_items", input: logItemsInput({ foods: names.map((name) => ({ ...TOOL_EGGS, name })) }) }, 0, language);

  it("says every step in the profile's language", () => {
    expect(stepText({ kind: "start" }, 0, "it")).toBe("Sto pensando…");
    expect(stepText({ kind: "start" }, 2, "es")).toBe("Mirando tus fotos…");
    expect(stepText({ kind: "reply" }, 0, "fr")).toBe("Rédaction de la réponse…");
    expect(stepText({ kind: "tool", name: "update_entry", input: null }, 0, "lt")).toBe("Atnaujinu jūsų žurnalą…");
  });

  it("joins a list the way the language does", () => {
    expect(log(["Uova strapazzate", "Pane tostato", "Caffè", "Succo", "Mela"], "it")).toBe("Registro uova strapazzate, pane tostato, caffè e altri 2…");
    expect(log(["鸡蛋", "吐司", "咖啡"], "zh")).toBe("正在记录鸡蛋、吐司和咖啡…");
  });

  it("keeps a German noun's capital", () => {
    expect(log(["Rührei", "Toast"], "de")).toBe("Trage Rührei und Toast ein…");
  });
});

describe("midSentence", () => {
  it("lowercases a name's first letter unless its first word is an acronym or has another capital", () => {
    expect(midSentence("Fried eggs")).toBe("fried eggs");
    expect(midSentence("BLT sandwich")).toBe("BLT sandwich");
    expect(midSentence("McFlurry")).toBe("McFlurry");
    expect(midSentence("Big Mac")).toBe("big Mac");
    expect(midSentence("  Oat & milk chocolate biscuits ")).toBe("oat & milk chocolate biscuits");
  });
});
