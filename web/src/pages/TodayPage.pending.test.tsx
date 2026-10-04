import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TodayPage } from "./TodayPage.tsx";

afterEach(() => vi.useRealTimers());

describe("TodayPage with a message still with the coach", () => {
  it("looks again until the coach is done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let loads = 0;
    mockFetch(() => {
      loads += 1;
      return jsonResponse(dayView({ messages: [message({ id: "m1", status: loads === 1 ? "pending" : "done" })] }));
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    expect(await screen.findByText("Sending…")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => expect(screen.queryByText("Sending…")).not.toBeInTheDocument());
  });
});
