import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render.tsx";
import { DayNav } from "./DayNav.tsx";

describe("DayNav", () => {
  it("labels today and cannot go into the future", () => {
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
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
});
