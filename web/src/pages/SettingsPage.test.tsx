import { fireEvent, screen, within } from "@testing-library/react";
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
    await userEvent.click(screen.getByRole("radio", { name: "Lose" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({
      sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80, activity_level: "light",
      goal: "lose", goal_rate_kg_week: 0.5, override_kcal: null,
      // A new profile starts in the phone's own timezone.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(screen.getByPlaceholderText("1860 kcal calculated")).toBeInTheDocument();
  });

  it("names the everyday activity levels in words, and still saves their keys", async () => {
    const puts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ error: "no_profile" }, 404);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: { ...HIDDEN_SETTINGS, ...body }, calculated: { kcal: 2000, protein_g: 144, carbs_g: 200, fat_g: 67, fibre_g: 30 } });
    });
    renderWithProviders(<SettingsPage />);
    const select = (await screen.findByLabelText("Everyday activity, excluding workouts")) as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ["sedentary", "Sedentary"], ["light", "Light"], ["moderate", "Moderate"], ["very", "Very active"],
    ]);
    expect(select).toHaveDisplayValue("Light");
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "80");
    await userEvent.selectOptions(select, "Very active");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ activity_level: "very" });
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
    expect(screen.getByLabelText("Calories override")).toHaveValue("2000");
    expect(screen.queryByLabelText("Rate (kg per week)")).toBeNull();
  });

  it("picks the timezone from a list grouped by region, with each zone's offset", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ error: "no_profile" }, 404);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: { ...HIDDEN_SETTINGS, ...body }, calculated: { kcal: 2000, protein_g: 144, carbs_g: 200, fat_g: 67, fibre_g: 30 } });
    });
    renderWithProviders(<SettingsPage />);
    const select = (await screen.findByLabelText("Timezone")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(expect.arrayContaining(["Asia", "Europe", "America"]));
    expect(screen.getByRole("option", { name: /^Shanghai \(UTC\+8\)$/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "165");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "55");
    await userEvent.selectOptions(select, "Asia/Shanghai");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ timezone: "Asia/Shanghai" });
  });

  it("keeps a stored timezone the list does not name", async () => {
    mockFetch(() =>
      jsonResponse({
        profile: {
          ...HIDDEN_SETTINGS, sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60,
          activity_level: "moderate", goal: "maintain", goal_rate_kg_week: 0, protein_g_per_kg: 1.6, fat_pct: 30,
          fibre_g: 30, add_back_pct: 50, override_kcal: null, override_protein_g: null, override_carbs_g: null,
          override_fat_g: null, override_fibre_g: null, timezone: "Etc/GMT-3",
        },
        calculated: { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 },
      }),
    );
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    expect(screen.getByLabelText("Timezone")).toHaveValue("Etc/GMT-3");
  });

  it("says why a new profile can't be saved yet, at the field, rather than doing nothing", async () => {
    const puts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method === "PUT") puts.push(init.body);
      return jsonResponse({ error: "no_profile" }, 404);
    });
    renderWithProviders(<SettingsPage />);
    await screen.findByLabelText("Birth date");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(puts).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Some details need a look. They're marked above.");
    expect(screen.getByLabelText("Birth date")).toHaveAccessibleDescription("Fill this in.");
    expect(screen.getByLabelText("Height (cm)")).toHaveAccessibleDescription("Fill this in.");
    expect(screen.getByLabelText("Birth date")).toHaveFocus();
  });

  it("asks for the name first, saves it trimmed, and settles Today's prompt", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ error: "no_profile" }, 404);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: { ...HIDDEN_SETTINGS, ...body }, calculated: { kcal: 2000, protein_g: 144, carbs_g: 200, fat_g: 67, fibre_g: 30 } });
    });
    renderWithProviders(<SettingsPage />);
    const name = await screen.findByLabelText("What should Zabaione call you?");
    expect(screen.getAllByRole("textbox")[0]).toBe(name);
    await userEvent.type(name, "  Bin ");
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ name: "Bin", name_prompt: "done" });
  });

  it("leaves Today's prompt alone when an existing profile is saved without a name", async () => {
    const puts: Record<string, unknown>[] = [];
    const existing = {
      ...HIDDEN_SETTINGS, sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60, activity_level: "moderate",
      goal: "maintain", goal_rate_kg_week: 0, protein_g_per_kg: 1.6, fat_pct: 30, fibre_g: 30, add_back_pct: 50,
      override_kcal: null, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
      timezone: "Europe/London", name: null, name_prompt: "show",
    };
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: existing, calculated: { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 } });
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: body, calculated: { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 } });
    });
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ name: null, name_prompt: "show" });
  });

  it("switches the theme at once, on this device only, without saving the profile", async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return jsonResponse({ error: "no_profile" }, 404);
    });
    renderWithProviders(<SettingsPage />);
    const theme = await screen.findByRole("group", { name: "Theme" });
    expect(screen.getByRole("radio", { name: "Auto" })).toBeChecked();
    await userEvent.click(within(theme).getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    await userEvent.click(within(theme).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
    await userEvent.click(within(theme).getByRole("radio", { name: "Auto" }));
    localStorage.clear();
  });
});
