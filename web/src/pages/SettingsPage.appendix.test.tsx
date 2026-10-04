import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { dayView } from "../test/fixtures.ts";
import { SettingsPage } from "./SettingsPage.tsx";

describe("appendix tests (from the implementer's report)", () => {
  const STORED = {
    sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60, activity_level: "moderate",
    goal: "lose", goal_rate_kg_week: 0.5, protein_g_per_kg: 1.6, fat_pct: 30, fibre_g: 30, add_back_pct: 50,
    override_kcal: 2000, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
    timezone: "Europe/London",
    body_goal_priority: "normal", units_mass: "st_lb", units_length: "in", context_days: 9, goal_notes: "off",
  };
  const CALC = { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 };

  it("sends the hidden settings back unchanged, a blank override as null and a typed one as a number", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: body, calculated: CALC });
    });
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.clear(screen.getByLabelText("Calories override"));
    await userEvent.type(screen.getByLabelText("Protein override (g)"), "150");
    await userEvent.click(screen.getByRole("radio", { name: "Maintain" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({
      body_goal_priority: "normal", units_mass: "st_lb", units_length: "in", context_days: 9, goal_notes: "off",
      override_kcal: null, override_protein_g: 150, goal: "maintain", goal_rate_kg_week: 0,
    });
  });

  it("takes back the Saved. note when sex or goal changes, and sends what was chosen", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: body, calculated: CALC });
    });
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");

    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(screen.queryByText("Saved.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");

    await userEvent.click(screen.getByRole("radio", { name: "Gain" }));
    expect(screen.queryByText("Saved.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");

    expect(puts).toHaveLength(3);
    expect(puts[1]).toMatchObject({ sex: "male", goal: "lose" });
    expect(puts[2]).toMatchObject({ sex: "male", goal: "gain", goal_rate_kg_week: 0.5 });
  });

  it("marks every cached day stale after saving", async () => {
    mockFetch(() => jsonResponse({ profile: STORED, calculated: CALC }));
    const { client } = renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    client.setQueryData(["day", "2026-10-03"], dayView());
    client.setQueryData(["day", "today"], dayView());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(client.getQueryState(["day", "2026-10-03"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["day", "today"])?.isInvalidated).toBe(true);
  });
});
