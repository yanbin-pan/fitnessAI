import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/index.tsx";
import type { InsightReport, InsightStats, InsightsHistory, WeekPoint } from "../shared.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { InsightsPage, loadWord, nutrientLevel } from "./InsightsPage.tsx";

const STATS: InsightStats = {
  period_start: "2026-09-28", period_end: "2026-10-04", days_logged: 7, food_days: 6,
  nutrients: {
    kcal: { average: 1980, target: 2100 }, protein_g: { average: 140, target: 144 }, carbs_g: { average: 210, target: 230 },
    fat_g: { average: 70, target: 70 }, fibre_g: { average: 18, target: 30 }, saturated_fat_g: { average: 28, target: 30 },
    sugars_g: { average: 70, target: 90 }, salt_g: { average: 7.5, target: 6 }, fluid_ml: { average: 900, target: 2000 },
  },
  protein_g_per_kg: 1.8, alcohol_units_per_week: 4, food_groups: { vegetables: 2, fruit: 1.2, legumes: 0.5 },
  training: {
    sessions_per_week: 3.5, minutes_per_week: 210, active_kcal_per_week: 1450, by_activity: [{ activity: "tennis", sessions: 8, minutes: 480 }],
    sets_per_muscle: { chest: 12 }, training_days_last_7: 3, longest_streak: 3, load_ratio: 1.05,
    dates: ["2026-09-29", "2026-10-01", "2026-10-03"],
  },
  signals: { days: 18, levels: { salt: "high", vitamin_d_ug: "low" } },
};
const REPORT: InsightReport = {
  headline: "Steady weeks: protein is on target, fibre is short.",
  nutrition: { summary: "You eat close to your calories.", findings: [{ title: "Fibre is low", detail: "18 g a day against 30 g.", severity: "act", foods: ["Oats", "Lentils"] }] },
  training: { summary: "Tennis twice a week.", findings: [{ title: "No strength work", detail: "No sets logged.", severity: "watch", foods: [] }] },
  recovery: { status: "balanced", detail: "Load is steady." },
  focus: ["Add a pear to lunch."],
};
const point = (week_start: string, kcal: number, sessions: number): WeekPoint => ({
  week_start, food_days: 6, kcal, kcal_target: 2100, protein_g: 140, protein_target: 144, protein_g_per_kg: 1.7, carbs_g: 210, fat_g: 70,
  fibre_g: 20, fibre_target: 30, sugars_g: 60, salt_g: 6, fluid_ml: 900, alcohol_units: 2, sessions, minutes: 200, active_kcal: 1400,
});
const PREVIOUS = point("2026-09-21", 2100, 2);
const ready = {
  status: "ready", data_days: 20, required_days: 7, next_update: "2026-10-12",
  insight: { week_start: "2026-10-05", generated_at: "2026-10-05T07:23:00Z", stats: STATS, report: REPORT, previous: PREVIOUS },
};
const HISTORY: InsightsHistory = {
  reports: [
    { week_start: "2026-10-05", period_start: "2026-09-28", period_end: "2026-10-04", headline: REPORT.headline, tally: { good: 0, watch: 1, act: 1 }, areas: { nutrition: "act", training: "watch", recovery: "good" } },
    { week_start: "2026-09-28", period_start: "2026-09-21", period_end: "2026-09-27", headline: "An older week.", tally: { good: 2, watch: 0, act: 0 }, areas: { nutrition: "good", training: "good", recovery: "good" } },
  ],
  weeks: [PREVIOUS, point("2026-09-28", 1980, 3.5)],
};
const OLDER = { week_start: "2026-09-28", generated_at: "2026-09-28T07:00:00Z", stats: { ...STATS, period_start: "2026-09-21", period_end: "2026-09-27" }, report: { ...REPORT, headline: "An older week." }, previous: null };

/** The tab's three addresses: this week, the history, and one past week. */
function serve(view: unknown) {
  return mockFetch((url) => (url.endsWith("/api/insights/history") ? jsonResponse(HISTORY) : url.endsWith("/api/insights/2026-09-28") ? jsonResponse(OLDER) : jsonResponse(view)));
}

describe("InsightsPage", () => {
  it("shows the days logged until there are seven", async () => {
    mockFetch(() => jsonResponse({ status: "collecting", data_days: 6, required_days: 7, next_update: "2026-10-12", insight: null }));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText("Your weekly analysis is on its way")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "6 / 7 days");
  });

  it("says the first analysis is being written", async () => {
    mockFetch(() => jsonResponse({ status: "pending", data_days: 7, required_days: 7, next_update: "2026-10-12", insight: null }));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByRole("status")).toHaveTextContent("Your first analysis is being written.");
  });

  it("shows the week's analysis: headline, numbers, meters, findings with their severity in words, recovery and focus", async () => {
    serve(ready);
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText(REPORT.headline)).toBeInTheDocument();
    expect(screen.getByText("28 Sept – 4 Oct")).toBeInTheDocument();
    expect(screen.getByText("Next report 12 October")).toBeInTheDocument();
    expect(screen.getByText("1,980")).toBeInTheDocument();
    expect(screen.getByText("of 2,100 kcal")).toBeInTheDocument();
    expect(screen.getByText("−120 vs the week before")).toBeInTheDocument();
    expect(screen.getByText("1 to change")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Training" })).toHaveTextContent("Training load: Steady");
    expect(screen.getByRole("list", { name: "Days with training" }).children).toHaveLength(7);
    const nutrition = screen.getByRole("region", { name: "Nutrition" });
    expect(within(nutrition).getByRole("meter", { name: "Salt (limit)" })).toHaveAttribute("aria-valuetext", "7.5 / 6 g, Worth changing");
    expect(within(nutrition).getByText("Fibre is low").closest("li")).toHaveTextContent("Worth changing");
    expect(within(nutrition).getByText("Lentils")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recovery" })).toHaveTextContent("Balanced");
    expect(screen.getByRole("region", { name: "This week" })).toHaveTextContent("Add a pear to lunch.");
  });

  it("shows the numbers alone when the coach is off", async () => {
    serve({ ...ready, status: "off", insight: { ...ready.insight, report: null } });
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText("Zabaione is switched off, so here are the numbers on their own.")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Fibre" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recovery" })).toBeNull();
  });
});

describe("past weeks and trends", () => {
  it("steps back to an earlier report and returns to the latest", async () => {
    serve(ready);
    renderWithProviders(<InsightsPage />);
    const earlier = await screen.findByRole("button", { name: "Earlier report" });
    await expect.poll(() => (earlier as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(earlier);
    expect(await screen.findByText("An older week.")).toBeInTheDocument();
    expect(screen.getByText("Past report")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to the latest" }));
    expect(await screen.findByText(REPORT.headline)).toBeInTheDocument();
  });

  it("plots each week's averages and lists every report, which opens on tap", async () => {
    serve(ready);
    renderWithProviders(<InsightsPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Trends" }));
    const calories = await screen.findByRole("region", { name: "Calories" });
    expect(within(calories).getByRole("img")).toHaveAttribute("aria-label", "Calories: 21 Sept 2,100, 28 Sept 1,980");
    expect(screen.getByText("Weekly averages · 2 weeks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salt" }));
    expect(screen.getByRole("region", { name: "Salt" })).toBeInTheDocument();
    const past = screen.getByRole("region", { name: "Past reports" });
    fireEvent.click(within(past).getByText("An older week."));
    expect(await screen.findByText("Past report")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("judging the numbers", () => {
  it("judges targets, bands and limits each their own way", () => {
    expect(nutrientLevel({ average: 2000, target: 2100 }, "near")).toBe("good");
    expect(nutrientLevel({ average: 2500, target: 2100 }, "near")).toBe("watch");
    expect(nutrientLevel({ average: 18, target: 30 }, "goal")).toBe("act");
    expect(nutrientLevel({ average: 6, target: 6 }, "limit")).toBe("good");
    expect(nutrientLevel({ average: 7, target: 6 }, "limit")).toBe("watch");
    expect(nutrientLevel({ average: 300, target: 2000 }, "drink")).toBe("watch");
  });

  it("names the training load", () => {
    expect([null, 0.5, 1, 1.4, 2].map((r) => loadWord(r, en))).toEqual(["No training", "Easing off", "Steady", "Rising", "Sharp rise"]);
  });
});
