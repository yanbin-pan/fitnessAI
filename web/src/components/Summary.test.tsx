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

  it("shows the calories left in the ring, or how far over", () => {
    const targets = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70, fibre_g: 30 };
    const totals = { kcal: 1500, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0 };
    const { rerender } = render(<Summary view={dayView({ targets: { base: targets, adjusted: targets, add_back_kcal: 0, workout_kcal: 0 }, totals })} />);
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("kcal left")).toBeInTheDocument();
    rerender(<Summary view={dayView({ targets: { base: targets, adjusted: targets, add_back_kcal: 0, workout_kcal: 0 }, totals: { ...totals, kcal: 2150 } })} />);
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("kcal over")).toBeInTheDocument();
  });
});
