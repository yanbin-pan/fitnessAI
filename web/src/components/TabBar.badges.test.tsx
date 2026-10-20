import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { noteHealthNews } from "../health/background.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TabBar } from "./TabBar.tsx";

const insights = (generated_at: string | null) => ({
  status: generated_at ? "ready" : "collecting", data_days: 20, required_days: 14, next_update: "2026-10-26",
  insight: generated_at ? { week_start: "2026-10-12", generated_at, stats: {}, report: null } : null,
});
const serveInsights = (generated_at: string | null) => mockFetch(() => jsonResponse(insights(generated_at)));

describe("TabBar badges", () => {
  it("shows a dot on Health when something there finished while you were away, and drops it once you open Health", async () => {
    serveInsights(null);
    const first = renderWithProviders(<TabBar />, { route: "/day/today" });
    expect(screen.getByRole("link", { name: "Health" })).toBeInTheDocument();
    act(() => noteHealthNews());
    expect(screen.getByRole("link", { name: "Health, new" })).toBeInTheDocument();
    first.unmount();
    renderWithProviders(<TabBar />, { route: "/health" });
    expect(screen.getByRole("link", { name: "Health" })).toBeInTheDocument();
  });

  it("shows no dot for news that lands while Health is open", () => {
    serveInsights(null);
    renderWithProviders(<TabBar />, { route: "/health/chat" });
    act(() => noteHealthNews());
    expect(screen.getByRole("link", { name: "Health" })).toBeInTheDocument();
  });

  it("shows a dot on Insights for a weekly report written since the tab was last open", async () => {
    localStorage.setItem("fitnessai.insights-seen", "2026-10-05T06:00:00.000Z");
    serveInsights("2026-10-12T06:00:00.000Z");
    const away = renderWithProviders(<TabBar />, { route: "/day/today" });
    expect(await screen.findByRole("link", { name: "Insights, new" })).toBeInTheDocument();
    away.unmount();
    renderWithProviders(<TabBar />, { route: "/insights" });
    await waitFor(() => expect(localStorage.getItem("fitnessai.insights-seen")).toBe("2026-10-12T06:00:00.000Z"));
    expect(screen.getByRole("link", { name: "Insights" })).toBeInTheDocument();
  });

  it("counts the first report a phone sees as seen", async () => {
    localStorage.removeItem("fitnessai.insights-seen");
    const fetch = serveInsights("2026-10-12T06:00:00.000Z");
    renderWithProviders(<TabBar />, { route: "/day/today" });
    await waitFor(() => expect(localStorage.getItem("fitnessai.insights-seen")).toBe("2026-10-12T06:00:00.000Z"));
    expect(fetch).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Insights" })).toBeInTheDocument();
  });
});
