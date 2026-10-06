import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dayView, entry, regular } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

describe("Composer: regulars", () => {
  it("shows nothing when there is no regular due", () => {
    renderWithProviders(<Composer suggestions={[]} />);
    expect(screen.queryByRole("list", { name: "Your regulars" })).toBeNull();
  });

  it("logs a regular with one tap, without a message to the coach", async () => {
    const fetch = mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    const { client } = renderWithProviders(<Composer suggestions={[regular(), regular({ key: "fedcba9876543210", name: "Tennis", kind: "activity", kcal: 480 })]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Porridge300 kcal", "Tennis480 kcal"]);
    await userEvent.click(screen.getByRole("button", { name: "Log Porridge, 300 kcal" }));
    await waitFor(() => expect(client.getQueryData(["day", "2026-10-03"])).toBeDefined());
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/regulars/0123456789abcdef/log");
    expect(JSON.parse(String(init?.body)).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetch.mock.calls.some(([u]) => u === "/api/messages")).toBe(false);
  });

  it("taps again with the same id after a lost answer, so the meal is logged once", async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return jsonResponse({ entry: entry(), day: dayView() });
    });
    renderWithProviders(<Composer suggestions={[regular()]} />);
    const chip = screen.getByRole("button", { name: "Log Porridge, 300 kcal" });
    await userEvent.click(chip);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't log that. Try again.");
    await userEvent.click(chip);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const ids = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).id);
    expect(ids[0]).toBe(ids[1]);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
