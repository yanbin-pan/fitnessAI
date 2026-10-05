import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/index.tsx";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const STORED = {
  sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60, activity_level: "moderate",
  goal: "lose", goal_rate_kg_week: 0.5, protein_g_per_kg: 1.6, fat_pct: 30, fibre_g: 30, add_back_pct: 50,
  override_kcal: 2000, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
  timezone: "Europe/London", body_goal_priority: "normal", units_mass: "kg", units_length: "cm", context_days: 5, goal_notes: "on",
  language: "en",
};
const CALC = { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 };

function renderSettings() {
  return renderWithProviders(
    <LanguageProvider>
      <SettingsPage />
    </LanguageProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
});

describe("SettingsPage: language", () => {
  it("lists every language in its own name and shows the app in the chosen one at once, saving it to the profile", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: body, calculated: CALC });
    });
    renderSettings();
    const select = (await screen.findByLabelText("App language")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "English", "Italiano", "中文（简体）", "Lietuvių", "Français", "Deutsch", "Español",
    ]);

    await userEvent.selectOptions(select, "Italiano");
    expect(screen.getByRole("heading", { name: "Impostazioni" })).toBeInTheDocument();
    expect(screen.getByLabelText("Lingua dell’app")).toHaveDisplayValue("Italiano");
    await waitFor(() => expect(puts).toHaveLength(1));
    // The stored profile goes back whole, with only the language changed.
    expect(puts[0]).toEqual({ ...STORED, language: "it" });
    expect(screen.getByRole("button", { name: "Salva" })).toBeInTheDocument();
  });

  it("keeps what is being typed elsewhere in the form when the language changes", async () => {
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
      return jsonResponse({ profile: JSON.parse(String(init.body)), calculated: CALC });
    });
    renderSettings();
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.clear(screen.getByLabelText("Weight (kg)"));
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "58");
    await userEvent.selectOptions(screen.getByLabelText("App language"), "Deutsch");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Einstellungen" })).toBeInTheDocument());
    expect(screen.getByLabelText("Gewicht (kg)")).toHaveValue(58);
  });

  it("goes back to the stored language and says so when it can't be saved", async () => {
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ profile: STORED, calculated: CALC });
      return jsonResponse({ error: "internal" }, 500);
    });
    renderSettings();
    await userEvent.selectOptions(await screen.findByLabelText("App language"), "Español");
    expect(await screen.findByText("Couldn't save the language. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("before there is a profile, shows the chosen language and sends it with the first Save", async () => {
    const puts: Record<string, unknown>[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ error: "no_profile" }, 404);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: { ...STORED, ...body }, calculated: CALC });
    });
    renderSettings();
    await userEvent.selectOptions(await screen.findByLabelText("App language"), "Lietuvių");
    expect(screen.getByRole("heading", { name: "Nustatymai" })).toBeInTheDocument();
    expect(puts).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Gimimo data"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Ūgis (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Svoris (kg)"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Išsaugoti" }));
    await screen.findByText("Išsaugota.");
    expect(puts[0]).toMatchObject({ language: "lt", height_cm: 180 });
    expect(screen.getByRole("heading", { name: "Nustatymai" })).toBeInTheDocument();
  });
});
