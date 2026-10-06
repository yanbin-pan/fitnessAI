import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useDay } from "../queries.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

/** Keeps today's day query on screen, as the Today page does. */
function DayOnScreen() {
  useDay("today");
  return null;
}

describe("Composer", () => {
  it("sends the text with a fresh id and timestamp, then clears the box", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ user: message(), reply: null, day: dayView() }, 201));
    renderWithProviders(<Composer />);
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "2 eggs on toast");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByLabelText("Message Zabaione")).toHaveValue(""));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    const body = JSON.parse(String(init?.body));
    expect(body.text).toBe("2 eggs on toast");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(body.sent_at))).toBe(false);
  });

  it("sits on the page colour, so the feed never shows between it and the tab bar", () => {
    renderWithProviders(<Composer />);
    expect(screen.getByLabelText("Message Zabaione").closest("form")).toHaveClass("bg-base", "pt-2", "pb-2");
  });

  it("keeps the text and explains when the phone is offline", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    renderWithProviders(<Composer />);
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "banana");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Message Zabaione")).toHaveValue("banana");
  });

  it("looks at the day again after a send fails, because the server may have the message all the same", async () => {
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method === "POST") throw new TypeError("Failed to fetch"); // the reply was lost on the way back
      return jsonResponse(dayView());
    });
    const dayLoads = () => fetchMock.mock.calls.filter(([url]) => url === "/api/days/today").length;
    renderWithProviders(<><DayOnScreen /><Composer /></>);
    await waitFor(() => expect(dayLoads()).toBe(1));
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "banana");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(dayLoads()).toBe(2));
  });
});
