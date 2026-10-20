import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tapHaptic } from "../haptics.ts";
import type { CompanionStatus } from "../shared.ts";
import { CompanionAvatar, useHoldHint } from "./CompanionButton.tsx";

const okay: CompanionStatus = { mood: "okay", avg_kcal: 2104, avg_target_kcal: 2316, days_logged: 6, okay_streak: 3, alcohol_units: 0, over_alcohol: false };

function Hint() {
  return useHoldHint() ? <p>hint</p> : null;
}

describe("the hold hint", () => {
  it("shows until the companion is first opened, and stays gone", async () => {
    const { unmount } = render(<><CompanionAvatar companion="zabaione" status={okay} live={false} /><Hint /></>);
    expect(screen.getByText("hint")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Zabaione/ }));
    expect(screen.queryByText("hint")).toBeNull();
    unmount();
    render(<Hint />);
    expect(screen.queryByText("hint")).toBeNull();
    expect(localStorage.getItem("fitnessai.companion-hint-seen")).toBe("1");
  });
});

describe("tapHaptic", () => {
  it("vibrates where the phone can, and otherwise toggles a hidden switch for iOS", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    tapHaptic();
    expect(vibrate).toHaveBeenCalledWith(10);
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
    tapHaptic();
    const input = document.querySelector<HTMLInputElement>('input[type="checkbox"][switch]');
    expect(input?.checked).toBe(true);
  });
});
