import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FactView, HealthView, Profile, ProfileView } from "../shared.ts";
import { storedProfile } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { AboutPrompt } from "./AboutPrompt.tsx";
import { OnboardingPage } from "./OnboardingPage.tsx";

const CALCULATED = { kcal: 2150, protein_g: 148, carbs_g: 215, fat_g: 72, fibre_g: 30 };

/** A small server: the profile, the Health tab's consent and facts. Every request is collected. */
function serve(start: Profile | null) {
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let profile = start;
  let health: HealthView = { consented_at: null, facts: [], documents: [], trends: [], suggestions: [] };
  mockFetch((url, init) => {
    const method = init?.method ?? (init?.body ? "POST" : "GET");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, url, body });
    const view = () => ({ profile, calculated: CALCULATED, companion_locked_until: null }) as ProfileView;
    if (url === "/api/profile" && method === "PUT") {
      profile = body as unknown as Profile;
      return jsonResponse(view());
    }
    if (url === "/api/profile") return profile ? jsonResponse(view()) : jsonResponse({ error: "no_profile" }, 404);
    if (url === "/api/records/consent") {
      health = { ...health, consented_at: "2026-10-20T10:00:00Z" };
      return jsonResponse(health);
    }
    if (url === "/api/records/facts" && method === "POST") {
      const fact = { id: `f${health.facts.length}`, status: "active", shared: true, document_id: null, created_at: "", detail: "", level: null, started_on: null, ended_on: null, ...body } as FactView;
      health = { ...health, facts: [...health.facts, fact] };
      return jsonResponse(fact, 201);
    }
    if (url === "/api/records") return jsonResponse(health);
    return jsonResponse({});
  });
  const puts = () => calls.filter((c) => c.method === "PUT" && c.url === "/api/profile").map((c) => c.body as unknown as Profile);
  return { calls, puts };
}

const next = (name: string | RegExp = "Continue") => userEvent.click(screen.getByRole("button", { name }));

describe("onboarding", () => {
  it("creates the profile on the body screen, then saves each answer and finishes on Today", async () => {
    const server = serve(null);
    renderWithProviders(<OnboardingPage />, { route: "/welcome", path: "/welcome" });

    await userEvent.type(await screen.findByLabelText("What should I call you?"), "Bin");
    await next("Let's start");

    await userEvent.click(screen.getByRole("button", { name: /Lose fat/ }));
    await userEvent.click(screen.getByRole("button", { name: /Skin glow/ }));
    await next("Continue · 2 picked");
    // Nothing is saved before there is a profile.
    expect(server.puts()).toHaveLength(0);

    // The body screen can't be skipped, and says what is missing.
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    await next();
    expect(screen.getAllByText("Fill this in.")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Lose" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "82");
    await userEvent.type(screen.getByLabelText("Goal weight (kg)"), "76");
    expect(screen.getByText(/At this pace you'd get there around/)).toBeInTheDocument();
    await next();

    await screen.findByText("How do you move?");
    expect(server.puts()[0]).toMatchObject({
      name: "Bin", name_prompt: "done", companion_prompt: "done", onboarding: "show", sex: "male", height_cm: 180, weight_kg: 82,
      goal: "lose", goal_rate_kg_week: 0.5, about: { focus: ["lose_fat", "skin"], target_weight_kg: 76 },
    });

    await userEvent.click(screen.getByRole("button", { name: "Gym" }));
    await next();
    await screen.findByText("Anything I should know about your health?");
    expect(server.puts().at(-1)?.about).toMatchObject({ sports: ["gym"], focus: ["lose_fat", "skin"] });

    // Health answers wait for consent, then each chip saves a fact straight away.
    expect(screen.queryByRole("button", { name: "High cholesterol" })).not.toBeInTheDocument();
    await next("Agree and continue");
    await userEvent.click(await screen.findByRole("button", { name: "High cholesterol" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "High cholesterol" })).toHaveAttribute("aria-pressed", "true"));
    expect(server.calls.find((c) => c.url === "/api/records/facts")?.body).toMatchObject({ kind: "condition", code: "high_cholesterol" });
    await next();

    await screen.findByText("How do you like to eat?");
    await next();
    // Skin was picked, so its screen shows.
    await screen.findByText("Because you picked Skin glow");
    await userEvent.click(screen.getByRole("button", { name: "More glow" }));
    await next();

    await userEvent.click(await screen.findByRole("radio", { name: /Straight talk/ }));
    await next("See my plan");
    await screen.findByText("Here's your plan, Bin");
    expect(server.puts().at(-1)).toMatchObject({ coach_tone: "direct", about: { skin_goals: ["glow"] } });
    expect(screen.getByText("2,150")).toBeInTheDocument();
    expect(screen.getByText("Saturated fat")).toBeInTheDocument();
    expect(screen.getByText("Added sugar and water")).toBeInTheDocument();

    await next("Start logging");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/day/today"));
    expect(server.puts().at(-1)).toMatchObject({ onboarding: "done" });
  });

  it("skips a screen without saving it, and leaves out Skin when it wasn't picked", async () => {
    const server = serve(storedProfile({ onboarding: "show", about: { ...storedProfile().about, focus: ["lose_fat"] } }));
    renderWithProviders(<OnboardingPage />, { route: "/welcome", path: "/welcome" });
    // An existing profile's answers are filled in.
    expect(await screen.findByLabelText("What should I call you?")).toHaveValue("Bin");
    await next("Let's start");
    await next(/^Continue/);
    await screen.findByText("About your body");
    expect(screen.getByLabelText("Height (cm)")).toHaveValue("180");
    await next();
    await screen.findByText("How do you move?");
    const saved = server.puts().length;
    await next("Skip");
    await screen.findByText("Anything I should know about your health?");
    expect(server.puts()).toHaveLength(saved);
    await next("Skip");
    await next("Skip");
    expect(await screen.findByRole("heading", { name: "Who's coaching you?" })).toBeInTheDocument();
  });
});

describe("AboutPrompt", () => {
  it("opens onboarding, or settles it with Not now", async () => {
    const server = serve(storedProfile({ onboarding: "show" }));
    const { client } = renderWithProviders(<AboutPrompt />);
    client.setQueryData(["profile"], { profile: storedProfile({ onboarding: "show" }), calculated: CALCULATED, companion_locked_until: null });
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/welcome");
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(server.puts().at(-1)).toMatchObject({ onboarding: "done", name: "Bin" }));
  });
});
