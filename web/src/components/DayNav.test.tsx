import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { DayNav } from "./DayNav.tsx";

describe("DayNav", () => {
  it("labels today, with the date beneath, and cannot go into the future", () => {
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Sat 3 Oct")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
  });

  it("steps back a day", async () => {
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/day/2026-10-02");
  });

  it("names older days and returns to /day/today when stepping onto today", async () => {
    renderWithProviders(<DayNav date="2026-10-02" today="2026-10-03" />);
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/day/today");
  });

  it("shows the year under a day older than yesterday", () => {
    renderWithProviders(<DayNav date="2026-09-28" today="2026-10-03" />);
    expect(screen.getByText("Mon 28 Sept")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("opens and closes the calendar from the button in the corner", async () => {
    mockFetch(() => jsonResponse({ goal: "lose", days: [] }));
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    const button = screen.getByRole("button", { name: "Calendar" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Pick a day" })).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes the calendar when the button is pressed again", async () => {
    mockFetch(() => jsonResponse({ goal: "lose", days: [] }));
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    const button = screen.getByRole("button", { name: "Calendar" });
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Pick a day" })).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
