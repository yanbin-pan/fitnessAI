import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { DayNav } from "./DayNav.tsx";
import { monthGrid, shiftMonth } from "./Calendar.tsx";

const october = (goal: string) => ({
  goal,
  days: [
    { date: "2026-10-01", kcal: 2000, target_kcal: 2310 },
    { date: "2026-10-02", kcal: 2450, target_kcal: 2310 },
    { date: "2026-10-03", kcal: 900, target_kcal: 2310 },
  ],
});

async function openCalendar(goal = "lose") {
  const fetchMock = mockFetch(() => jsonResponse(october(goal)));
  renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
  await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
  return fetchMock;
}

describe("monthGrid", () => {
  it("is six weeks from the Monday on or before the 1st", () => {
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-28");
    expect(grid[41]).toBe("2026-11-08");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("Calendar", () => {
  it("asks for the six weeks it shows and tints the past days by how they went", async () => {
    const fetchMock = await openCalendar();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/days?from=2026-09-28&to=2026-11-08");
    const first = await screen.findByRole("button", { name: "1 October: 2,000 of 2,310 kcal, within target" });
    expect(first).toHaveClass("bg-tint-within");
    expect(screen.getByRole("button", { name: "2 October: 2,450 of 2,310 kcal, up to 10\u00a0% over" })).toHaveClass("bg-tint-near");
    const today = screen.getByRole("button", { name: "3 October, today" });
    expect(today).not.toHaveClass("bg-tint-within");
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveFocus();
  });

  it("words the legend and the days for a gaining goal", async () => {
    await openCalendar("gain");
    expect(await screen.findByRole("button", { name: "2 October: 2,450 of 2,310 kcal, target reached" })).toHaveClass("bg-tint-within");
    expect(screen.getByRole("button", { name: "1 October: 2,000 of 2,310 kcal, more than 10\u00a0% under" })).toHaveClass("bg-tint-off");
    expect(screen.getByText("Target reached")).toBeInTheDocument();
  });

  it("greys out the future and never goes past the current month", async () => {
    await openCalendar();
    expect(screen.getByRole("button", { name: "4 October" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "30 September" })).toBeEnabled());
  });

  it("opens the day you pick and folds itself away", async () => {
    await openCalendar();
    await userEvent.click(await screen.findByRole("button", { name: /^1 October/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/day/2026-10-01");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when you tap outside it", async () => {
    await openCalendar();
    await userEvent.click(screen.getByTestId("calendar-scrim"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on the month of the day being viewed, with that day pressed in", async () => {
    mockFetch(() => jsonResponse(october("lose")));
    renderWithProviders(<DayNav date="2026-09-28" today="2026-10-03" />);
    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    const viewed = screen.getByRole("button", { name: "28 September" });
    expect(viewed).toHaveAttribute("aria-pressed", "true");
    expect(viewed).toHaveFocus();
  });

  it("reads the numbers the way the app shows them: calories to the kcal, the target to 10", async () => {
    mockFetch(() => jsonResponse({ goal: "lose", days: [{ date: "2026-10-02", kcal: 2363.6, target_kcal: 2315.7 }] }));
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(await screen.findByRole("button", { name: "2 October: 2,364 of 2,320 kcal, up to 10\u00a0% over" })).toHaveClass("bg-tint-near");
  });
});
