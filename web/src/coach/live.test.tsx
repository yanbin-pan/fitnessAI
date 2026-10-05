import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_STEP_MS, dropLive, finishLive, firstStep, isLive, pushStep, resetLive, startLive, useStep } from "./live.ts";

function Step({ id }: { id: string }) {
  return <output data-testid={id}>{useStep(id) ?? "none"}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLive();
});
afterEach(() => {
  resetLive();
  vi.useRealTimers();
});

describe("live steps", () => {
  it("starts with the photo-aware first words", () => {
    expect([firstStep(0), firstStep(1), firstStep(2)]).toEqual(["Thinking…", "Looking at your photo…", "Looking at your photos…"]);
  });

  it("shows the first words at once and holds each later step for at least 1.5 s", () => {
    render(<Step id="m1" />);
    act(() => startLive("m1", "Thinking…"));
    expect(screen.getByTestId("m1")).toHaveTextContent("Thinking…");
    act(() => {
      vi.advanceTimersByTime(9000);
      pushStep("m1", "Logging fried eggs…");
      pushStep("m1", "Writing a reply…");
    });
    expect(screen.getByTestId("m1")).toHaveTextContent("Logging fried eggs…");
    act(() => vi.advanceTimersByTime(MIN_STEP_MS - 1));
    expect(screen.getByTestId("m1")).toHaveTextContent("Logging fried eggs…");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("m1")).toHaveTextContent("Writing a reply…");
  });

  it("holds the first words too when a step comes straight after them", () => {
    render(<Step id="m1" />);
    act(() => {
      startLive("m1", "Thinking…");
      pushStep("m1", "Logging…");
    });
    expect(screen.getByTestId("m1")).toHaveTextContent("Thinking…");
    act(() => vi.advanceTimersByTime(MIN_STEP_MS));
    expect(screen.getByTestId("m1")).toHaveTextContent("Logging…");
  });

  it("forgets the steps when the reply arrives, and keeps the latest one when the stream drops", () => {
    render(
      <>
        <Step id="a" />
        <Step id="b" />
      </>,
    );
    act(() => {
      startLive("a", "Thinking…");
      startLive("b", "Thinking…");
      pushStep("b", "Writing a reply…");
    });
    expect(isLive("a")).toBe(true);
    act(() => {
      finishLive("a");
      dropLive("b");
    });
    expect(isLive("a")).toBe(false);
    expect(isLive("b")).toBe(false);
    expect(screen.getByTestId("a")).toHaveTextContent("none");
    expect(screen.getByTestId("b")).toHaveTextContent("Writing a reply…");
  });

  it("ignores a step for a message that isn't streaming", () => {
    pushStep("x", "Thinking…");
    expect(isLive("x")).toBe(false);
  });
});
