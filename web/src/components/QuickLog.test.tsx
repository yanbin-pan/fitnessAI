import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { QuickItem } from "../shared.ts";
import { dayView, entry, regular } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";
import { matchQuick } from "./QuickLog.tsx";

const item = (overrides: Partial<QuickItem> = {}): QuickItem => ({
  ref: "f:11111111-1111-4111-8111-111111111111", kind: "meal", name: "Porridge", kcal: 420, activity: null, pinned: true, due: false, logged_today: false,
  ...overrides,
});
const ITEMS = [
  item(),
  item({ ref: "f:22222222-2222-4222-8222-222222222222", name: "Chicken rice bowl", kcal: 640 }),
  item({ ref: "r:0123456789abcdef", name: "Flat white", kcal: 90, pinned: false }),
];

describe("matchQuick", () => {
  it("matches the start of each word typed, ignoring case and accents, from two letters", () => {
    expect(matchQuick(ITEMS, "p")).toEqual([]);
    expect(matchQuick(ITEMS, "PO").map((i) => i.name)).toEqual(["Porridge"]);
    expect(matchQuick(ITEMS, "chi ri").map((i) => i.name)).toEqual(["Chicken rice bowl"]);
    expect(matchQuick(ITEMS, "rice").map((i) => i.name)).toEqual(["Chicken rice bowl"]);
    expect(matchQuick([item({ name: "Café latte" })], "cafe").map((i) => i.name)).toEqual(["Café latte"]);
    expect(matchQuick(ITEMS, "idge")).toEqual([]);
  });
});

describe("Composer: quick log", () => {
  it("shows no quick button on a day other than today, and nothing above the bar until it is opened", async () => {
    const { unmount } = renderWithProviders(<Composer date="2026-10-02" quick={ITEMS} />);
    expect(screen.queryByRole("button", { name: "Quick log" })).toBeNull();
    unmount();
    renderWithProviders(<Composer date="2026-10-03" quick={ITEMS} quickOn />);
    expect(screen.queryByRole("list", { name: "Frequent items" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Something you usually log now" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Quick log" }));
    expect(screen.getByRole("list", { name: "Frequent items" })).toBeInTheDocument();
  });

  it("puts a dot on the button while something is due", () => {
    renderWithProviders(<Composer date="2026-10-03" quick={[item({ due: true })]} quickOn />);
    expect(screen.getByRole("img", { name: "Something you usually log now" })).toBeInTheDocument();
  });

  it("logs a pinned item with one tap, without the coach, then offers an undo", async () => {
    const logged = entry({ id: "33333333-3333-4333-8333-333333333333" });
    const fetch = mockFetch((url) => (url.startsWith("/api/entries/") ? jsonResponse({ day: dayView() }) : jsonResponse({ entry: logged, day: dayView() }, 201)));
    renderWithProviders(<Composer date="2026-10-03" quick={ITEMS} quickOn />);
    await userEvent.click(screen.getByRole("button", { name: "Quick log" }));
    await userEvent.click(screen.getByRole("button", { name: "Log Porridge, 420 kcal" }));
    expect(await screen.findByText("Logged Porridge")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Frequent items" })).toBeNull();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/frequent/11111111-1111-4111-8111-111111111111/log");
    expect(JSON.parse(String(init?.body)).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetch.mock.calls.some(([u]) => u === "/api/messages")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fetch.mock.calls.at(-1)?.[0]).toBe(`/api/entries/${logged.id}`));
    expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByText("Logged Porridge")).toBeNull());
  });

  it("logs a suggestion through its regular, and pins it with its +", async () => {
    const fetch = mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<Composer date="2026-10-03" quick={ITEMS} quickOn />);
    await userEvent.click(screen.getByRole("button", { name: "Quick log" }));
    await userEvent.click(screen.getByRole("button", { name: "Pin Flat white" }));
    await waitFor(() => expect(fetch.mock.calls[0][0]).toBe("/api/regulars/0123456789abcdef/pin"));
    await userEvent.click(screen.getByRole("button", { name: "Log Flat white, 90 kcal" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === "/api/regulars/0123456789abcdef/log")).toBe(true));
  });

  it("offers matches while typing; a tap logs it and clears the text", async () => {
    mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<Composer date="2026-10-03" quick={ITEMS} quickOn />);
    const box = screen.getByRole("textbox", { name: "Message Zabaione" });
    await userEvent.type(box, "chi");
    const matches = screen.getByRole("list", { name: "Matching frequent items" });
    expect(matches.textContent).toContain("Chicken rice bowl");
    expect(matches.textContent).not.toContain("Porridge");
    await userEvent.click(screen.getByRole("button", { name: "Log Chicken rice bowl, 640 kcal" }));
    await waitFor(() => expect(box).toHaveValue(""));
    expect(screen.queryByRole("list", { name: "Matching frequent items" })).toBeNull();
  });

  it("opens the Frequent sheet from ⋯, with pinned items and suggestions to pin", async () => {
    mockFetch(() => jsonResponse({
      items: [{ id: "11111111-1111-4111-8111-111111111111", kind: "meal", name: "Porridge", foods: regular().foods, exercises: [], kcal: 300, slot: "morning", source_key: null, times_logged: 2, logged_today: false }],
      suggestions: [regular({ name: "Flat white", days_seen: 6 })],
    }));
    renderWithProviders(<Composer date="2026-10-03" quick={ITEMS} quickOn />);
    await userEvent.click(screen.getByRole("button", { name: "Quick log" }));
    await userEvent.click(screen.getByRole("button", { name: "Manage frequent items" }));
    const sheet = await screen.findByRole("dialog", { name: "Frequent" });
    expect(await screen.findByRole("button", { name: /^Porridge/ })).toBeInTheDocument();
    expect(sheet.textContent).toContain("Suggested from your logs");
    expect(sheet.textContent).toContain("Seen 6 days in 4 weeks");
    await userEvent.click(screen.getByRole("button", { name: /^Porridge/ }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Porridge");
    expect(screen.getByText("Logged 2 times in 4 weeks")).toBeInTheDocument();
  });
});
