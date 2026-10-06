import { describe, expect, it } from "vitest";
import { fillGreeting, greetingFor, greetingMoment } from "./greeting.ts";
import { MESSAGES } from "./i18n/index.tsx";
import { en } from "./i18n/en.ts";
import { dayView, entry, exerciseItem, foodItem } from "./test/fixtures.ts";

// Local times, as the phone sees them.
const at = (hour: number) => new Date(2026, 9, 6, hour, 15);
const ate = (kcal: number, protein_g = 0) => ({ ...dayView().totals, kcal, protein_g });
const breakfast = entry({ id: "b", foods: [foodItem()], exercises: [] });

describe("fillGreeting", () => {
  it("puts the name in, or leaves its part out when there is none", () => {
    expect(fillGreeting("Gm[ {n}]! New day.", "Bin", 0)).toBe("Gm Bin! New day.");
    expect(fillGreeting("Gm[ {n}]! New day.", null, 0)).toBe("Gm! New day.");
    expect(fillGreeting("Evening[, {n}]. {left} kcal left.", null, 640)).toBe("Evening. 640 kcal left.");
  });

  it("names the person, or reads cleanly without a name, in every language", () => {
    for (const [language, messages] of Object.entries(MESSAGES)) {
      for (const [moment, template] of Object.entries(messages.greeting)) {
        // The name only ever sits inside a part that can be left out.
        expect(template.replace(/\[[^\]]*\]/g, ""), `${language} ${moment}`).not.toContain("{n}");
        expect(fillGreeting(template, "Bin", 500), `${language} ${moment}`).toContain("Bin");
        expect(fillGreeting(template, null, 500), `${language} ${moment}`).not.toMatch(/[[\]{}]/);
      }
    }
  });
});

describe("greetingMoment", () => {
  it("goes by the time of day while nothing is logged", () => {
    expect(greetingMoment(dayView(), at(8)).moment).toBe("morningEmpty");
    expect(greetingMoment(dayView(), at(14)).moment).toBe("afternoonEmpty");
    expect(greetingMoment(dayView(), at(20)).moment).toBe("eveningEmpty");
    expect(greetingMoment(dayView(), at(1)).moment).toBe("lateNight");
  });

  it("then by how the day is going: over target, protein hit, a workout, room left in the evening", () => {
    const logged = { entries: [breakfast] };
    expect(greetingMoment(dayView({ ...logged, totals: ate(2600) }), at(20)).moment).toBe("over");
    expect(greetingMoment(dayView({ ...logged, totals: ate(1500, 150) }), at(13)).moment).toBe("proteinHit");
    const workout = entry({ id: "w", foods: [], exercises: [exerciseItem()] });
    expect(greetingMoment(dayView({ entries: [breakfast, workout], totals: ate(900) }), at(13)).moment).toBe("workout");
    expect(greetingMoment(dayView({ ...logged, totals: ate(1700) }), at(19))).toEqual({ moment: "eveningRoom", left: 610 });
    expect(greetingMoment(dayView({ ...logged, totals: ate(900) }), at(13)).moment).toBe("going");
  });
});

describe("greetingFor", () => {
  it("is Zabaione's hello in the app's language, with the name", () => {
    expect(greetingFor(dayView(), "Bin", at(8), en)).toBe("Gm Bin! New day, new macros. What's for breakfast?");
    expect(greetingFor(dayView(), null, at(8), MESSAGES.it)).toBe("Buongiorno! Cosa c'è per colazione?");
  });
});
