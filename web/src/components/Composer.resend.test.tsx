import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

const stored = () => jsonResponse({ user: message(), reply: null, day: dayView() }, 201);
const sent = (calls: unknown[][]) => calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { id: string; sent_at: string; text: string });

describe("Composer resend", () => {
  it("resends the same id and timestamp when the same text is sent again after a lost response", async () => {
    let attempts = 0;
    const fetchMock = mockFetch(() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch"); // the server may have processed it all the same
      return stored();
    });
    renderWithProviders(<Composer />);
    const box = screen.getByLabelText("Message your coach");
    await userEvent.type(box, "2 eggs on toast");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(box).toHaveValue(""));
    const [first, second] = sent(fetchMock.mock.calls);
    expect(second.id).toBe(first.id);
    expect(second.sent_at).toBe(first.sent_at);
  });

  it("uses a new id when the text was changed after a failure", async () => {
    let attempts = 0;
    const fetchMock = mockFetch(() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return stored();
    });
    renderWithProviders(<Composer />);
    const box = screen.getByLabelText("Message your coach");
    await userEvent.type(box, "2 eggs");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    await userEvent.type(box, " on toast");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(box).toHaveValue(""));
    const [first, second] = sent(fetchMock.mock.calls);
    expect(second.text).toBe("2 eggs on toast");
    expect(second.id).not.toBe(first.id);
  });

  it("uses a new id for the next message once one has gone through", async () => {
    const fetchMock = mockFetch(() => stored());
    renderWithProviders(<Composer />);
    const box = screen.getByLabelText("Message your coach");
    for (let round = 0; round < 2; round += 1) {
      await userEvent.type(box, "banana");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(box).toHaveValue(""));
    }
    const [first, second] = sent(fetchMock.mock.calls);
    expect(second.id).not.toBe(first.id);
  });
});
