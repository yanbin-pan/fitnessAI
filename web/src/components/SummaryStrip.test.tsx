import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView } from "../test/fixtures.ts";
import { SummaryStrip } from "./SummaryStrip.tsx";

describe("SummaryStrip", () => {
  it("says the kcal left and takes you back to the summary", async () => {
    const onClick = vi.fn();
    const totals = { kcal: 2030, protein_g: 96, carbs_g: 248, fat_g: 58, fibre_g: 22, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0 };
    render(<SummaryStrip view={dayView({ totals })} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "280 kcal left. Back to the summary" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("says how far over, once over", () => {
    const totals = { kcal: 2500, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0 };
    render(<SummaryStrip view={dayView({ totals })} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /^190 kcal over\./ })).toBeInTheDocument();
  });
});
