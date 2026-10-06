import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES } from "../i18n/index.tsx";
import { SIGNAL_KEYS } from "../shared.ts";
import { NutrientCard, toneOf } from "./NutrientCard.tsx";

afterEach(() => localStorage.clear());

const signals = {
  days: 6,
  levels: { unsaturated_fat: "ok", saturated_fat: "high", sugars: "low", salt: "ok", vitamin_c_mg: "high", vitamin_d_ug: "low", iron_mg: "ok" },
} as const;

describe("NutrientCard", () => {
  it("starts folded, opens to words for each nutrient, and never shows a number", async () => {
    render(<NutrientCard signals={signals} />);
    const toggle = screen.getByRole("button", { name: /Vitamins, fats & sugar/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Salt")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const fats = screen.getByRole("list", { name: "Fats, sugar & salt" });
    expect(within(fats).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Unsaturated fatOn point", "Saturated fatA lot", "SugarChill", "SaltOn point",
    ]);
    const micros = screen.getByRole("list", { name: "Vitamins & minerals" });
    expect(within(micros).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Vitamin CStacked", "Vitamin DA bit low", "IronOn point"]);
    expect(screen.getByText("Vitamin D comes mostly from sunlight, so food alone often reads low.")).toBeInTheDocument();
    // No amounts and no targets: only the caption's "7 days".
    expect(document.body.textContent).not.toMatch(/\d\s*(mg|µg|ug|g|kcal|%)\b/);
    expect(document.body.textContent?.match(/\d+/g)).toEqual(["7"]);
  });

  it("remembers being open", async () => {
    const { unmount } = render(<NutrientCard signals={signals} />);
    await userEvent.click(screen.getByRole("button", { name: /Vitamins/ }));
    unmount();
    render(<NutrientCard signals={signals} />);
    expect(screen.getByRole("button", { name: /Vitamins/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("says so when there isn't enough logged, and when the vitamins aren't estimated yet", async () => {
    localStorage.setItem("nutrients-open", "1");
    const { rerender } = render(<NutrientCard signals={{ days: 1, levels: {} }} />);
    expect(screen.getByText("Not enough logged yet to say. A few days of meals and this fills in.")).toBeInTheDocument();
    rerender(<NutrientCard signals={{ days: 4, levels: { salt: "ok", sugars: "ok", saturated_fat: "ok", unsaturated_fat: "ok" } }} />);
    expect(screen.getByText(/Vitamins and minerals appear once the coach/)).toBeInTheDocument();
  });
});

describe("toneOf", () => {
  it("is never alarming: low is calm for what you need, high is only a heads-up for what to keep moderate", () => {
    expect(toneOf("vitamin_c_mg", "low")).toBe("calm");
    expect(toneOf("vitamin_c_mg", "high")).toBe("good");
    expect(toneOf("salt", "low")).toBe("good");
    expect(toneOf("salt", "high")).toBe("heads-up");
  });
});

describe("the words", () => {
  it("name every nutrient and level in every language", () => {
    for (const [language, words] of Object.entries(MESSAGES)) {
      for (const key of SIGNAL_KEYS) expect(words.nutrients.names[key], `${language} ${key}`).toBeTruthy();
      for (const level of ["low", "ok", "high"] as const) {
        expect(words.nutrients.enough[level], language).toBeTruthy();
        expect(words.nutrients.moderate[level], language).toBeTruthy();
      }
    }
  });
});
