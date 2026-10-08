import { describe, expect, it } from "vitest";
import { MESSAGES, withCompanion } from "./index.tsx";

describe("withCompanion", () => {
  it("leaves the messages as they are for Zabaione", () => {
    expect(withCompanion(MESSAGES.en, "zabaione")).toBe(MESSAGES.en);
  });

  it("puts the companion's name wherever the messages name the coach, in every language", () => {
    const t = withCompanion(MESSAGES.en, "panna-cotta");
    expect(t.composer.message).toBe("Message Panna Cotta");
    expect(t.settings.name).toBe("What should Panna Cotta call you?");
    expect(t.companion.why.sluggish).toBe("Well under target this week. Panna Cotta is running on empty.");
    expect(withCompanion(MESSAGES.it, "meringa").namePrompt.title).toBe("Ciao! Come vuoi che Meringa ti chiami?");
    expect(withCompanion(MESSAGES.zh, "cannolo").feed.emptyToday).toContain("告诉 Cannolo");
  });

  it("renames inside message functions but never what they are given, and keeps lists as lists", () => {
    const t = withCompanion(MESSAGES.en, "tiramisu");
    expect(t.companionPrompt.choose("Zabaione")).toBe("Choose Zabaione");
    expect(t.companion.open("Tiramisù", "Okay")).toBe("Tiramisù, Okay. How your week is going");
    expect(t.calendar.weekdays).toEqual(MESSAGES.en.calendar.weekdays);
    expect(t.locale).toBe("en-GB");
  });
});
