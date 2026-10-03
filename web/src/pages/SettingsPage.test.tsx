import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const HIDDEN_SETTINGS = { body_goal_priority: "high", units_mass: "kg", units_length: "cm", context_days: 5, goal_notes: "on" };

describe("SettingsPage", () => {
  it("creates the profile with a PUT, then shows the calculated calories", async () => {
    const puts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ error: "no_profile" }, 404);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: { ...HIDDEN_SETTINGS, ...body }, calculated: { kcal: 1863.125, protein_g: 144, carbs_g: 182, fat_g: 62, fibre_g: 30 } });
    });
    renderWithProviders(<SettingsPage />);

    fireEvent.change(await screen.findByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "80");
    await userEvent.selectOptions(screen.getByLabelText("Goal"), "lose");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({
      sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80, activity_level: "light",
      goal: "lose", goal_rate_kg_week: 0.5, override_kcal: null, timezone: "Europe/London",
    });
    expect(screen.getByPlaceholderText("1860 kcal calculated")).toBeInTheDocument();
  });

  it("loads an existing profile into the form", async () => {
    mockFetch(() =>
      jsonResponse({
        profile: {
          ...HIDDEN_SETTINGS, sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60,
          activity_level: "moderate", goal: "maintain", goal_rate_kg_week: 0, protein_g_per_kg: 1.6, fat_pct: 30,
          fibre_g: 30, add_back_pct: 50, override_kcal: 2000, override_protein_g: null, override_carbs_g: null,
          override_fat_g: null, override_fibre_g: null, timezone: "Europe/London",
        },
        calculated: { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 },
      }),
    );
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByDisplayValue("1990-05-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Calories override")).toHaveValue(2000);
    expect(screen.queryByLabelText("Rate (kg per week)")).toBeNull();
  });
});
