import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dayView } from "../test/fixtures.ts";
import { Summary } from "./Summary.tsx";

describe("Summary", () => {
  it("shows eaten against the adjusted target, the exercise add-back and the macro bars", () => {
    const adjusted = { kcal: 2490, protein_g: 150, carbs_g: 294, fat_g: 80, fibre_g: 30 };
    const view = dayView({
      targets: { base: { kcal: 2310, protein_g: 150, carbs_g: 260, fat_g: 75, fibre_g: 30 }, adjusted, add_back_kcal: 180, workout_kcal: 360 },
      totals: { kcal: 1240, protein_g: 98, carbs_g: 140, fat_g: 41, fibre_g: 12, saturated_fat_g: 9, sugars_g: 30, salt_g: 3, fluid_ml: 500, alcohol_units: 0 },
    });
    render(<Summary view={view} />);
    expect(screen.getByText("1240")).toBeInTheDocument();
    expect(screen.getByText("/ 2490 kcal")).toBeInTheDocument();
    expect(screen.getByText("+180 kcal from 360 kcal of exercise")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Protein" })).toHaveAttribute("aria-valuenow", "98");
  });
});
