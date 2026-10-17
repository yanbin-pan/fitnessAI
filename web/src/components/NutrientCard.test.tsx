import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES } from "../i18n/index.tsx";
import { SIGNAL_KEYS } from "../shared.ts";
import { foodItem } from "../test/fixtures.ts";
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
    expect(screen.getByText(/Vitamins and minerals appear once Zabaione/)).toBeInTheDocument();
  });
});

describe("NutrientCard: the day's fat and sugar", () => {
  const foods = [
    foodItem({ id: "a", name: "Croissant", fat_g: 14, saturated_fat_g: 8.5, sugars_g: 6, added_sugars_g: 5 }),
    foodItem({ id: "b", name: "Orange juice", fat_g: 0, saturated_fat_g: 0, sugars_g: 18, added_sugars_g: 18 }),
    foodItem({ id: "c", name: "Chocolate", fat_g: 14, saturated_fat_g: 8.4, sugars_g: 25, added_sugars_g: 24 }),
    foodItem({ id: "d", name: "Salmon salad", fat_g: 28, saturated_fat_g: 5, sugars_g: 5, added_sugars_g: 0 }),
  ];

  it("puts today's numbers in the closed card's subtitle, the one over its maximum in red", () => {
    render(<NutrientCard signals={signals} foods={foods} />);
    const toggle = screen.getByRole("button", { name: /Vitamins, fats & sugar/ });
    expect(toggle).toHaveTextContent("Today: 47 g added sugar · 22 g saturated fat");
    expect(within(toggle).getByText("47 g added sugar")).toHaveClass("text-danger");
    expect(within(toggle).getByText("22 g saturated fat")).not.toHaveClass("text-danger");
  });

  it("opens to fat split into unsaturated and saturated, and added sugar against 30 g, above the 7-day words", async () => {
    localStorage.setItem("nutrients-open", "1");
    render(<NutrientCard signals={signals} foods={foods} sex="female" />);
    const today = screen.getByRole("list", { name: "Today" });
    expect(today).toHaveTextContent("Fat56 g");
    expect(today).toHaveTextContent("34 g unsaturated");
    // 20 g for women: 22 g is over it.
    expect(within(today).getByText("22 / 20 g saturated").closest("span")).toHaveClass("text-danger");
    expect(today).toHaveTextContent("Added sugar47 / 30 g");
    expect(today).toHaveTextContent("17 g over the daily max · 54 g sugars in all");
    expect(screen.getByTestId("sugar-over")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();

    await userEvent.click(within(today).getByRole("button", { name: /Added sugar/ }));
    expect(within(today).getAllByRole("listitem").slice(2).map((li) => li.textContent)).toEqual(["Chocolate24 g", "Orange juice18 g", "Croissant5 g"]);
  });

  it("leaves added sugar out on a day logged before it was estimated, and says what a mixed day leaves out", () => {
    localStorage.setItem("nutrients-open", "1");
    const old = foods.map((food) => ({ ...food, added_sugars_g: null }));
    const { rerender } = render(<NutrientCard signals={signals} foods={old} isToday={false} />);
    expect(screen.getByRole("list", { name: "This day" })).not.toHaveTextContent("Added sugar");
    rerender(<NutrientCard signals={signals} foods={[...old.slice(0, 2), ...foods.slice(2)]} />);
    expect(screen.getByRole("list", { name: "Today" })).toHaveTextContent("2 earlier items aren't counted");
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
