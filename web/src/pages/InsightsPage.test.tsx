import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/index.tsx";
import type { InsightReport, InsightStats } from "../shared.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { InsightsPage, loadWord, nutrientLevel } from "./InsightsPage.tsx";

const STATS: InsightStats = {
  period_start: "2026-09-07", period_end: "2026-10-04", days_logged: 20, food_days: 18,
  nutrients: {
    kcal: { average: 1980, target: 2100 }, protein_g: { average: 140, target: 144 }, carbs_g: { average: 210, target: 230 },
    fat_g: { average: 70, target: 70 }, fibre_g: { average: 18, target: 30 }, saturated_fat_g: { average: 28, target: 30 },
    sugars_g: { average: 70, target: 90 }, salt_g: { average: 7.5, target: 6 }, fluid_ml: { average: 900, target: 2000 },
  },
  protein_g_per_kg: 1.8, alcohol_units_per_week: 4, food_groups: { vegetables: 2, fruit: 1.2, legumes: 0.5 },
  training: {
    sessions_per_week: 3.5, minutes_per_week: 210, active_kcal_per_week: 1450, by_activity: [{ activity: "tennis", sessions: 8, minutes: 480 }],
    sets_per_muscle: { chest: 12 }, training_days_last_7: 3, longest_streak: 3, load_ratio: 1.05,
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
const ready = { status: "ready", data_days: 20, required_days: 14, next_update: "2026-10-12", insight: { week_start: "2026-10-05", generated_at: "2026-10-05T07:23:00Z", stats: STATS, report: REPORT } };

describe("InsightsPage", () => {
  it("shows the days logged until there are fourteen", async () => {
    mockFetch(() => jsonResponse({ status: "collecting", data_days: 6, required_days: 14, next_update: "2026-10-12", insight: null }));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText("Your weekly analysis is on its way")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "6 / 14 days");
  });

  it("says the first analysis is being written", async () => {
    mockFetch(() => jsonResponse({ status: "pending", data_days: 14, required_days: 14, next_update: "2026-10-12", insight: null }));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByRole("status")).toHaveTextContent("Your first analysis is being written.");
  });

  it("shows the week's analysis: headline, numbers, meters, findings with their severity in words, recovery and focus", async () => {
    mockFetch(() => jsonResponse(ready));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText(REPORT.headline)).toBeInTheDocument();
    expect(screen.getByText("Week of 5 October · Next update 12 October")).toBeInTheDocument();
    expect(screen.getByText("1,980")).toBeInTheDocument();
    expect(screen.getByText("of 2,100 kcal")).toBeInTheDocument();
    expect(screen.getByText("Steady")).toBeInTheDocument();
    const nutrition = screen.getByRole("region", { name: "Nutrition" });
    expect(within(nutrition).getByRole("meter", { name: "Salt (limit)" })).toHaveAttribute("aria-valuetext", "7.5 / 6 g, Worth changing");
    expect(within(nutrition).getByText("Fibre is low").closest("li")).toHaveTextContent("Worth changing");
    expect(within(nutrition).getByText("Lentils")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recovery" })).toHaveTextContent("Balanced");
    expect(screen.getByRole("region", { name: "This week" })).toHaveTextContent("Add a pear to lunch.");
  });

  it("shows the numbers alone when the coach is off", async () => {
    mockFetch(() => jsonResponse({ ...ready, status: "off", insight: { ...ready.insight, report: null } }));
    renderWithProviders(<InsightsPage />);
    expect(await screen.findByText("The coach is switched off, so here are the numbers on their own.")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Fibre" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recovery" })).toBeNull();
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
