import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const STORED = {
  sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60, activity_level: "moderate",
  goal: "lose", goal_rate_kg_week: 0.5, protein_g_per_kg: 1.6, fat_pct: 30, fibre_g: 30, add_back_pct: 50,
  override_kcal: 2000, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
  timezone: "Europe/London",
  body_goal_priority: "normal", units_mass: "st_lb", units_length: "in", context_days: 9, goal_notes: "off",
};
const CALC = { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 };

describe("SettingsPage: failure paths", () => {
  it.each([
    ["a server error", () => jsonResponse({ error: "internal" }, 500)],
    ["being offline", () => { throw new TypeError("Failed to fetch"); }],
  ])("shows an error, not the blank form, when the profile can't be loaded (%s), and Try again loads it", async (_name, failure) => {
    let failing = true;
    mockFetch(() => (failing ? failure() : jsonResponse({ profile: STORED, calculated: CALC })));
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your settings.");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText("Birth date")).toBeNull();

    failing = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByDisplayValue("1990-05-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Calories override")).toHaveValue("2000");
  });

  it("keeps the form when a later refetch fails (the stored profile is still cached)", async () => {
    let failing = false;
    mockFetch(() => {
      if (failing) throw new TypeError("Failed to fetch");
      return jsonResponse({ profile: STORED, calculated: CALC });
    });
    const { client } = renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    failing = true;
    await client.invalidateQueries({ queryKey: ["profile"] });
    await waitFor(() => expect(client.getQueryState(["profile"])?.status).toBe("error"));
    expect(screen.getByDisplayValue("1990-05-01")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your settings.")).toBeNull();
  });

  it.each(["Protein (g per kg)", "Fat (% of calories)", "Fibre (g)", "Exercise calories added back (%)", "Rate (kg per week)"])(
    "does not save while %s is blank",
    async (label) => {
      const puts: unknown[] = [];
      mockFetch((_url, init) => {
        if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
        puts.push(JSON.parse(String(init.body)));
        return jsonResponse({ profile: STORED, calculated: CALC });
      });
      renderWithProviders(<SettingsPage />);
      await screen.findByDisplayValue("1990-05-01");
      await userEvent.clear(screen.getByLabelText(label));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(puts).toHaveLength(0);
      expect(screen.getByLabelText(label)).toBeInvalid();
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription("Fill this in.");
      expect(screen.getByRole("alert")).toHaveTextContent("Some details need a look.");
      expect(screen.queryByText("Saved.")).toBeNull();
    },
  );

  it.each([
    ["Height (cm)", "95", "Between 100 and 250."],
    ["Weight (kg)", "abc", "Enter a number."],
    ["Fat (% of calories)", "55", "Between 15 and 50."],
    ["Calories override", "-5", "Can't be negative."],
  ])("says what is wrong with %s = %s, next to it, instead of saving", async (label, value, message) => {
    const puts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
      return jsonResponse({ profile: STORED, calculated: CALC });
    });
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.clear(screen.getByLabelText(label));
    await userEvent.type(screen.getByLabelText(label), value);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(puts).toHaveLength(0);
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(message);
    expect(screen.getByLabelText(label)).toHaveFocus();
    // Fixing it clears its message.
    await userEvent.type(screen.getByLabelText(label), "{backspace}");
    expect(screen.getByLabelText(label)).not.toBeInvalid();
  });

  it("takes a decimal comma, as an Italian or Lithuanian keyboard types it", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: body, calculated: CALC });
    });
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.clear(screen.getByLabelText("Weight (kg)"));
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "68,5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ weight_kg: 68.5 });
  });

  it("marks the field the server refuses, should it refuse one the form let through", async () => {
    mockFetch((_url, init) =>
      init?.method === "PUT"
        ? jsonResponse({ error: "invalid_request", issues: [{ path: "height_cm", message: "Too small" }] }, 400)
        : jsonResponse({ profile: STORED, calculated: CALC }),
    );
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Check that every value is filled in and in range.");
    expect(screen.getByLabelText("Height (cm)")).toHaveAccessibleDescription("Check this value.");
  });

  it("still saves a blank override as null (blank override means 'use the calculation')", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ override_kcal: null, body_goal_priority: "normal", units_mass: "st_lb", context_days: 9 });
  });
});
