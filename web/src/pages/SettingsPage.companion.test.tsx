import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const HIDDEN_SETTINGS = { body_goal_priority: "high", units_mass: "kg", units_length: "cm", context_days: 5, goal_notes: "on" };
const CALCULATED = { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 };
const EXISTING = {
  ...HIDDEN_SETTINGS, sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60, activity_level: "moderate",
  goal: "maintain", goal_rate_kg_week: 0, protein_g_per_kg: 1.6, fat_pct: 30, fibre_g: 30, add_back_pct: 50,
  override_kcal: null, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
  timezone: "Europe/London", name: "Bin", name_prompt: "done", companion: "zabaione", companion_prompt: "show",
};

function serve(stored: object | null, puts: Record<string, unknown>[], lockedUntil: string | null = null) {
  mockFetch((_url, init) => {
    if (init?.method !== "PUT") {
      return stored ? jsonResponse({ profile: stored, calculated: CALCULATED, companion_locked_until: lockedUntil }) : jsonResponse({ error: "no_profile" }, 404);
    }
    const body = JSON.parse(String(init.body));
    puts.push(body);
    return jsonResponse({ profile: { ...HIDDEN_SETTINGS, ...body }, calculated: CALCULATED });
  });
}

describe("SettingsPage companion", () => {
  it("lets a new profile pick its companion at setup, Zabaione until another is picked", async () => {
    const puts: Record<string, unknown>[] = [];
    serve(null, puts);
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByRole("radio", { name: /Zabaione/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /Tiramisù/ }));
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ companion: "tiramisu", companion_prompt: "done" });
  });

  it("settles Today's question when the companion is changed, and leaves it alone otherwise", async () => {
    const puts: Record<string, unknown>[] = [];
    serve(EXISTING, puts);
    renderWithProviders(<SettingsPage />);
    await screen.findByDisplayValue("1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({ companion: "zabaione", companion_prompt: "show" });
    await userEvent.click(screen.getByRole("radio", { name: /Cantuccio/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(puts[1]).toMatchObject({ companion: "cantuccio", companion_prompt: "done" });
  });

  it("asks for the name in the words of the companion picked just above, before it is saved", async () => {
    serve(EXISTING, []);
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByLabelText("What should Zabaione call you?")).toBeInTheDocument();
    expect(screen.getByText("You can change it once every 3 months, so pick one you like.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Sfogliatella/ }));
    expect(screen.getByLabelText("What should Sfogliatella call you?")).toBeInTheDocument();
    expect(screen.getByText("Your first name or a nickname. Sfogliatella uses it to say hi.")).toBeInTheDocument();
  });

  it("keeps the companion while it was changed in the last 3 months, and says from when it can change", async () => {
    serve({ ...EXISTING, companion: "meringa", companion_prompt: "done" }, [], "2027-01-08");
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText("You can pick another companion from 8 January: it can change once every 3 months.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Meringa/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Meringa/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Tiramisù/ })).toBeDisabled();
  });

  it("says why a change was refused when the companion was changed elsewhere meanwhile", async () => {
    mockFetch((_url, init) =>
      init?.method === "PUT"
        ? jsonResponse({ error: "companion_locked", until: "2027-01-08" }, 409)
        : jsonResponse({ profile: EXISTING, calculated: CALCULATED, companion_locked_until: null }),
    );
    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole("radio", { name: /Cannolo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Your companion can change only once every 3 months, so that wasn't saved.")).toBeInTheDocument();
  });
});
