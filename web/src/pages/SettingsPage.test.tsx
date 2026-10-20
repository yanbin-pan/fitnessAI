import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HealthView, Profile, ProfileView } from "../shared.ts";
import { storedProfile } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const CALCULATED = { kcal: 2150, protein_g: 148, carbs_g: 215, fat_g: 72, fibre_g: 30 };
const NO_HEALTH: HealthView = { consented_at: null, facts: [], documents: [], trends: [], suggestions: [] };

/** Serves the profile and health, answering a PUT with the profile it was sent; the PUT bodies are collected. */
function serve(profile: Profile | null, { locked = null as string | null, health = NO_HEALTH, failPut = false } = {}) {
  const puts: Partial<Profile>[] = [];
  let current = profile;
  mockFetch((url, init) => {
    if (url === "/api/records") return jsonResponse(health);
    if (url === "/api/profile" && init?.method === "PUT") {
      if (failPut) return jsonResponse({ error: "internal" }, 500);
      const body = JSON.parse(String(init.body)) as Profile;
      puts.push(body);
      current = body;
      return jsonResponse({ profile: body, calculated: CALCULATED, companion_locked_until: locked } satisfies ProfileView);
    }
    if (url === "/api/profile") {
      return current ? jsonResponse({ profile: current, calculated: CALCULATED, companion_locked_until: locked } satisfies ProfileView) : jsonResponse({ error: "no_profile" }, 404);
    }
    return jsonResponse({});
  });
  return puts;
}

const open = (route: string) => renderWithProviders(<SettingsPage />, { route, path: "/settings/*" });

describe("Settings home", () => {
  it("shows the profile card and a row per page, each with what it holds", async () => {
    serve(storedProfile());
    open("/settings");
    expect(await screen.findByText("Bin")).toBeInTheDocument();
    expect(screen.getByText("Losing 0.5 kg a week · 82 → 76 kg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Daily targets/ })).toHaveTextContent("2,150 kcal");
    expect(screen.getByRole("link", { name: /Goals and body/ })).toHaveTextContent("Lose fat, Skin glow");
    expect(screen.getByRole("link", { name: /Training/ })).toHaveTextContent("4× a week");
    expect(screen.getByRole("link", { name: /Coach/ })).toHaveTextContent("Zabaione, Balanced");
    expect(screen.getByRole("link", { name: /^Health/ })).toHaveAttribute("href", "/health");
    // Skin shows because it is among the goals.
    expect(screen.getByRole("link", { name: /^Skin/ })).toHaveAttribute("href", "/settings/skin");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("leaves out Skin when it is not a goal", async () => {
    serve(storedProfile({ about: { ...storedProfile().about, focus: ["lose_fat"], skin_goals: [] } }));
    open("/settings");
    await screen.findByText("Bin");
    expect(screen.queryByRole("link", { name: /^Skin/ })).not.toBeInTheDocument();
  });

  it("sends someone without a profile to onboarding", async () => {
    serve(null);
    open("/settings");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/welcome"));
  });

  it("shows an error, not a form, when the profile can't be loaded, and Try again loads it", async () => {
    let fail = true;
    mockFetch((url) => {
      if (url === "/api/profile") return fail ? jsonResponse({ error: "internal" }, 500) : jsonResponse({ profile: storedProfile(), calculated: CALCULATED, companion_locked_until: null });
      return jsonResponse(NO_HEALTH);
    });
    open("/settings");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your settings");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Bin")).toBeInTheDocument();
  });
});

describe("Settings pages", () => {
  it("saves a target of your own when its field is left, and Reset goes back to Auto", async () => {
    const puts = serve(storedProfile());
    open("/settings/targets");
    const carbs = await screen.findByLabelText("Carbs");
    expect(carbs).toHaveAttribute("placeholder", "215");
    await userEvent.type(carbs, "200");
    fireEvent.blur(carbs);
    await screen.findByText("Saved");
    expect(puts.at(-1)).toMatchObject({ override_carbs_g: 200, override_kcal: null, weight_kg: 82, name: "Bin" });
    await userEvent.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ override_carbs_g: null }));
  });

  it("steps protein per kg and picks how much exercise is eaten back", async () => {
    const puts = serve(storedProfile());
    open("/settings/targets");
    await userEvent.click(await screen.findByRole("button", { name: "Protein per kg: more" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ protein_g_per_kg: 1.9 }));
    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ add_back_pct: 100 }));
  });

  it("marks a body number that can't be saved, and saves nothing until it is fixed", async () => {
    const puts = serve(storedProfile());
    open("/settings/goals");
    const height = await screen.findByLabelText("Height (cm)");
    await userEvent.clear(height);
    await userEvent.type(height, "95");
    fireEvent.blur(height);
    expect(await screen.findByText("Between 100 and 250.")).toBeInTheDocument();
    expect(puts).toHaveLength(0);
    await userEvent.clear(height);
    await userEvent.type(height, "181,5");
    fireEvent.blur(height);
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ height_cm: 181.5, about: { target_weight_kg: 76, focus: ["lose_fat", "skin"] } }));
  });

  it("saves a goal picked from the chips straight away", async () => {
    const puts = serve(storedProfile());
    open("/settings/goals");
    await userEvent.click(await screen.findByRole("button", { name: "More energy" }));
    await waitFor(() => expect(puts.at(-1)?.about?.focus).toEqual(["lose_fat", "skin", "energy"]));
  });

  it("saves the coach's tone, and keeps the companion while it is locked", async () => {
    const puts = serve(storedProfile(), { locked: "2026-11-02" });
    open("/settings/coach");
    expect(await screen.findByText(/You can pick another companion from 2 November/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tiramisù/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Straight talk/ }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ coach_tone: "direct", companion: "zabaione" }));
  });

  it("says when a change didn't save", async () => {
    serve(storedProfile(), { failPut: true });
    open("/settings/training");
    await userEvent.click(await screen.findByRole("button", { name: "Padel" }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
  });

  it("asks for consent before diets and foods, and still saves the eating habits", async () => {
    const puts = serve(storedProfile());
    open("/settings/food");
    expect(await screen.findByRole("button", { name: "Agree and continue" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Weekends" }));
    await waitFor(() => expect(puts.at(-1)?.about).toMatchObject({ alcohol: "weekends", focus: ["lose_fat", "skin"] }));
  });
});
