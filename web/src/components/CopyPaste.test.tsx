import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { clearCopied, toggleCopied } from "../copied.ts";
import { TodayPage } from "../pages/TodayPage.tsx";
import { dayView, entry, exerciseItem, foodItem } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";

const porridge = entry({ id: "e1", date: "2026-10-02", logged_at: "2026-10-02T07:10:00.000Z" });
const coffee = entry({ id: "e2", date: "2026-10-02", logged_at: "2026-10-02T07:15:00.000Z", foods: [foodItem({ id: "f2", name: "Flat white", kcal: 120 })] });
const tennis = entry({ id: "e3", date: "2026-10-02", logged_at: "2026-10-02T18:00:00.000Z", foods: [], exercises: [exerciseItem()] });
const yesterday = dayView({ date: "2026-10-02", entries: [porridge, coffee, tennis] });

function renderDay(date: string) {
  return renderWithProviders(<TodayPage />, { route: `/day/${date}`, path: "/day/:date" });
}

/** Serves `view` for any day, and answers a paste with the day plus one entry (or the given failure). */
function fakeServer(view = yesterday, failure?: { status: number; error: string }) {
  const pastes: { date: string; copies: { id: string; from: string }[] }[] = [];
  mockFetch((url, init) => {
    if (url === "/api/entries/copy") {
      pastes.push(JSON.parse(String(init?.body)));
      if (failure) return jsonResponse({ error: failure.error }, failure.status);
      const added = entry({ id: "new", date: view.date, foods: [foodItem({ id: "f9", name: "Porridge" })] });
      return jsonResponse({ entries: [added], day: { ...view, entries: [...view.entries, added] } }, 201);
    }
    return jsonResponse(view);
  });
  return pastes;
}

afterEach(() => clearCopied());

describe("copying and pasting entries", () => {
  it("shows no paste until an entry is copied", async () => {
    fakeServer();
    renderDay("2026-10-02");
    expect(await screen.findByRole("button", { name: "Copy: Porridge" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });

  it("copies entries from their cards and pastes them through the server, not the coach", async () => {
    const pastes = fakeServer();
    renderDay("2026-10-02");
    await userEvent.click(await screen.findByRole("button", { name: "Copy: Porridge" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy: Tennis" }));
    expect(screen.getByRole("button", { name: "Copy: Porridge" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Paste 2" }));
    await waitFor(() => expect(pastes).toHaveLength(1));
    expect(pastes[0]).toEqual({
      date: "2026-10-02",
      copies: [{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), from: "e1" }, { id: expect.stringMatching(/^[0-9a-f-]{36}$/), from: "e3" }],
    });
    // Still copied, to paste on the next day too.
    expect(screen.getByRole("button", { name: "Paste 2" })).toBeInTheDocument();
  });

  it("takes an entry out of the copy when its button is tapped again", async () => {
    fakeServer();
    renderDay("2026-10-02");
    const copy = await screen.findByRole("button", { name: "Copy: Porridge" });
    await userEvent.click(copy);
    expect(screen.getByRole("button", { name: "Paste 1" })).toBeInTheDocument();
    await userEvent.click(copy);
    expect(copy).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });

  it("sends a failed paste again with the same ids", async () => {
    toggleCopied(porridge);
    const pastes = fakeServer(dayView(), { status: 500, error: "internal" });
    renderDay("today");
    await userEvent.click(await screen.findByRole("button", { name: "Paste 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Paste 1" }));
    await waitFor(() => expect(pastes).toHaveLength(2));
    expect(pastes[1].copies[0].id).toBe(pastes[0].copies[0].id);
  });

  it("forgets the copy when a copied entry has been deleted since", async () => {
    toggleCopied(porridge);
    fakeServer(dayView(), { status: 404, error: "not_found" });
    renderDay("today");
    await userEvent.click(await screen.findByRole("button", { name: "Paste 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something you copied has been deleted since");
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });

  it("clears the copy", async () => {
    toggleCopied(porridge);
    fakeServer(dayView());
    renderDay("today");
    await userEvent.click(await screen.findByRole("button", { name: "Clear copied entries" }));
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });

  it("copies from a day too old to add to, but pastes only where an entry may go", async () => {
    fakeServer(dayView({ date: "2026-09-20", entries: [entry({ id: "old", date: "2026-09-20" })] }));
    renderDay("2026-09-20");
    await userEvent.click(await screen.findByRole("button", { name: "Copy: Porridge" }));
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });
});
