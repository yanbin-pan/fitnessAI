import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { entry, regular } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { EntryCard } from "./EntryCard.tsx";

describe("the star on an entry card", () => {
  it("saves the entry to Frequent with one tap", async () => {
    const fetch = mockFetch((url, init) => (init?.method === "PUT" ? jsonResponse({}) : jsonResponse({ items: [], suggestions: [] })));
    const logged = entry();
    renderWithProviders(<EntryCard entry={logged} />);
    const star = await screen.findByRole("button", { name: /^Save to Frequent: / });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(star).toBeEnabled());
    await userEvent.click(star);
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const [url, init] = fetch.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(url).toMatch(/^\/api\/frequent\/[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init?.body))).toMatchObject({ foods: logged.foods.map((f) => ({ name: f.name })), source_key: null });
  });

  it("is filled while a frequent item has the same items, and a tap removes that item", async () => {
    const logged = entry();
    const item = { id: "11111111-1111-4111-8111-111111111111", kind: "meal", name: "x", foods: logged.foods.map((f) => ({ ...regular().foods[0], name: f.name.toUpperCase() })), exercises: logged.exercises, kcal: 1, slot: "any", source_key: null, times_logged: 0, logged_today: false };
    const fetch = mockFetch((url, init) => (init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse({ items: [item], suggestions: [] })));
    renderWithProviders(<EntryCard entry={logged} />);
    const star = await screen.findByRole("button", { name: /^Saved to Frequent: tap to remove: / });
    expect(star).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(star);
    await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === `/api/frequent/${item.id}` && init?.method === "DELETE")).toBe(true));
  });
});
