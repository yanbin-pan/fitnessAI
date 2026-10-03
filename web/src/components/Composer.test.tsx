import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

describe("Composer", () => {
  it("sends the text with a fresh id and timestamp, then clears the box", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ user: message(), reply: null, day: dayView() }, 201));
    renderWithProviders(<Composer />);
    await userEvent.type(screen.getByLabelText("Message your coach"), "2 eggs on toast");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByLabelText("Message your coach")).toHaveValue(""));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    const body = JSON.parse(String(init?.body));
    expect(body.text).toBe("2 eggs on toast");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(body.sent_at))).toBe(false);
  });

  it("keeps the text and explains when the phone is offline", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    renderWithProviders(<Composer />);
    await userEvent.type(screen.getByLabelText("Message your coach"), "banana");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Message your coach")).toHaveValue("banana");
  });
});
