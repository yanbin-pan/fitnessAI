import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry, foodItem } from "../test/fixtures.ts";
import type { AlcoholWeek } from "../shared.ts";
import { ActivitiesCard } from "./ActivitiesCard.tsx";
import { Summary } from "./Summary.tsx";

const pint = (id: string) => foodItem({ id, name: "Lager", quantity: "1 pint", kcal: 200, protein_g: 2, carbs_g: 18, fat_g: 0, fibre_g: 0, alcohol_units: 2.3, drink: "beer", groups: [] });
const red = foodItem({ id: "w1", name: "Red wine", quantity: "175 ml", kcal: 160, protein_g: 0, carbs_g: 4, fat_g: 0, fibre_g: 0, alcohol_units: 2.3, drink: "wine", groups: [] });
const pub = entry({ id: "pub", logged_at: "2026-10-03T19:10:00.000Z", foods: [pint("p1"), pint("p2")] });
const dinner = entry({ id: "dinner", logged_at: "2026-10-03T20:30:00.000Z", foods: [foodItem({ id: "f1", kcal: 600, carbs_g: 70, groups: [] }), red] });
const week: AlcoholWeek = {
  units: 16.1, status: "over", alcohol_free_days: 4,
  days: [
    { date: "2026-09-27", units: 0 }, { date: "2026-09-28", units: 6.9 }, { date: "2026-09-29", units: 0 }, { date: "2026-09-30", units: 0 },
    { date: "2026-10-01", units: 2.3 }, { date: "2026-10-02", units: 0 }, { date: "2026-10-03", units: 6.9 },
  ],
  drinks: [{ drink: "beer", count: 5, units: 11.5, kcal: 1000 }, { drink: "wine", count: 2, units: 4.6, kcal: 320 }],
};
const totals = { kcal: 1160, protein_g: 14, carbs_g: 110, fat_g: 10, fibre_g: 5, saturated_fat_g: 2, sugars_g: 10, salt_g: 1, fluid_ml: 0, alcohol_units: 6.9 };

describe("drinks on Today", () => {
  it("stripe what the drinks add to the calories and each macro, and say how much", () => {
    render(<Summary view={dayView({ entries: [pub, dinner], totals })} />);
    expect(screen.getByText("560 kcal from drinks")).toBeInTheDocument();
    expect(screen.getByTestId("ring-drinks")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Carbs" })).toHaveAttribute("aria-valuetext", expect.stringContaining("40 g from drinks"));
    expect(screen.getByTestId("Carbs-drinks")).toHaveClass("stripes", "stripes-carbs");
    // Nothing from drinks for fibre: no stripes there.
    expect(screen.queryByTestId("Fibre-drinks")).toBeNull();
  });

  it("show no drink share on a day without drinks", () => {
    render(<Summary view={dayView({ entries: [entry({ foods: [foodItem()] })] })} />);
    expect(screen.queryByText(/kcal from drinks/)).toBeNull();
    expect(screen.queryByTestId("ring-drinks")).toBeNull();
  });

  it("give a badge only to the kinds had on the day, with how many and their units, and the week as a pill", () => {
    render(<ActivitiesCard view={dayView({ entries: [pub, dinner], alcohol: week })} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: "Beer: 2 today, 4.6 units" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wine: 1 today, 2.3 units" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cocktail/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Alcohol, last 7 days: 16.1 units. 2.1 units over the UK guide of 14 a week." })).toBeInTheDocument();
  });

  it("open the week behind the pill: against the guide, day by day and by drink", async () => {
    render(<ActivitiesCard view={dayView({ entries: [pub, dinner], alcohol: week })} onEdit={() => {}} />);
    const pill = screen.getByRole("button", { name: /Alcohol, last 7 days/ });
    await userEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Last 7 days" });
    expect(panel).toHaveTextContent("of 14 units");
    expect(panel).toHaveTextContent("4 alcohol-free days");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(7 + 2);
    expect(panel).toHaveTextContent("Beer, 5 drinks");
    expect(panel).toHaveTextContent("1000 kcal");
  });

  it("open a kind's drinks of the day, with the alcohol's own calories, and edit their entry", async () => {
    const onEdit = vi.fn();
    render(<ActivitiesCard view={dayView({ entries: [pub, dinner], alcohol: week })} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: /Beer: 2 today/ }));
    const panel = screen.getByRole("region", { name: "Beer today" });
    expect(within(panel).getAllByText("Lager")).toHaveLength(2);
    expect(panel).toHaveTextContent("258 kcal from the alcohol itself");
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(pub);
  });

  it("show the pill on a day with no drinks of its own while the week has some, and nothing when it has none", () => {
    const { rerender } = render(<ActivitiesCard view={dayView({ entries: [], alcohol: week })} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: /Alcohol, last 7 days/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /today/ })).toBeNull();
    rerender(<ActivitiesCard view={dayView({ entries: [], alcohol: null })} onEdit={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
