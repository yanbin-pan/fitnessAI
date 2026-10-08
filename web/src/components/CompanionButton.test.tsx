import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CompanionStatus } from "../shared.ts";
import { CompanionButton } from "./CompanionButton.tsx";

const okay: CompanionStatus = { mood: "okay", avg_kcal: 2104, avg_target_kcal: 2316, days_logged: 6, okay_streak: 3 };

describe("CompanionButton", () => {
  it("names the companion and its mood, and opens the bubble with the week behind it", async () => {
    render(<CompanionButton companion="tiramisu" status={okay} />);
    const button = screen.getByRole("button", { name: "Tiramisù, Okay. How your week is going" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    const bubble = screen.getByRole("dialog", { name: "Tiramisù" });
    expect(bubble).toHaveTextContent("Bear cub");
    expect(bubble).toHaveTextContent("Okay");
    expect(bubble).toHaveTextContent("Right around target this week. Steady.");
    expect(bubble).toHaveTextContent("7-day average: 2,104 of 2,320 kcal");
    expect(bubble).toHaveTextContent("3 of 14 days on track towards Thriving");
    expect(bubble).toHaveTextContent("Follows your 7-day average, not a single day.");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape, the close button and the scrim, and gives the focus back", async () => {
    render(<CompanionButton companion="meringa" status={okay} />);
    const button = screen.getByRole("button", { name: /Meringa/ });
    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(button);
    await userEvent.click(screen.getByTestId("companion-scrim"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why for every mood, without numbers when asleep", async () => {
    const { rerender } = render(<CompanionButton companion="zabaione" status={{ ...okay, mood: "inactive", okay_streak: 0 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Zabaione, Inactive. How your week is going" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Nothing logged for a week");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("7-day average:");
    rerender(<CompanionButton companion="zabaione" status={{ ...okay, mood: "sluggish", okay_streak: 0 }} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Zabaione is running on empty.");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("days on track");
    rerender(<CompanionButton companion="zabaione" status={{ ...okay, mood: "overfed", okay_streak: 0 }} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Zabaione is a bit stuffed.");
    rerender(<CompanionButton companion="zabaione" status={{ ...okay, mood: "thriving", okay_streak: 14 }} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Two weeks on track.");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("days on track towards");
    rerender(<CompanionButton companion="zabaione" status={{ mood: "okay", avg_kcal: null, avg_target_kcal: null, days_logged: 0, okay_streak: 0 }} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Awake again.");
  });
});
