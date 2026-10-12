import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { clearCopied, copyEntries } from "../copied.ts";
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

/** Serves `view` for any day, and answers a paste with `pasted` (or the given failure). */
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
  it("copies the chosen entries and pastes them through the server, not the coach", async () => {
    const pastes = fakeServer();
    renderDay("2026-10-02");
    await userEvent.click(await screen.findByRole("button", { name: "Copy entries" }));
    const picker = screen.getByRole("dialog", { name: "Copy entries" });
    expect(within(picker).getByRole("button", { name: "Copy" })).toBeDisabled();
    await userEvent.click(within(picker).getByRole("checkbox", { name: /Porridge/ }));
    await userEvent.click(within(picker).getByRole("checkbox", { name: /Tennis/ }));
    await userEvent.click(within(picker).getByRole("button", { name: "Copy 2" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const paste = screen.getByRole("button", { name: /Paste 2 copied entries/ });
    expect(paste).toHaveTextContent("From Yesterday: Porridge; Tennis");
    await userEvent.click(paste);
    await waitFor(() => expect(pastes).toHaveLength(1));
    expect(pastes[0]).toEqual({
      date: "2026-10-02",
      copies: [{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), from: "e1" }, { id: expect.stringMatching(/^[0-9a-f-]{36}$/), from: "e3" }],
    });
    // Still copied, to paste on the next day too.
    expect(screen.getByRole("button", { name: /Paste 2 copied entries/ })).toBeInTheDocument();
  });

  it("selects every entry at once", async () => {
    fakeServer();
    renderDay("2026-10-02");
    await userEvent.click(await screen.findByRole("button", { name: "Copy entries" }));
    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Copy 3" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("sends a failed paste again with the same ids, and a new paste with new ones", async () => {
    copyEntries("2026-10-02", [porridge]);
    const pastes = fakeServer(dayView(), { status: 500, error: "internal" });
    renderDay("today");
    await userEvent.click(await screen.findByRole("button", { name: /Paste 1 copied entry/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
    await userEvent.click(screen.getByRole("button", { name: /Paste 1 copied entry/ }));
    await waitFor(() => expect(pastes).toHaveLength(2));
    expect(pastes[1].copies[0].id).toBe(pastes[0].copies[0].id);
  });

  it("forgets the copy when a copied entry has been deleted since", async () => {
    copyEntries("2026-10-02", [porridge]);
    fakeServer(dayView(), { status: 404, error: "not_found" });
    renderDay("today");
    await userEvent.click(await screen.findByRole("button", { name: /Paste 1 copied entry/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something you copied has been deleted since");
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });

  it("clears the copy", async () => {
    copyEntries("2026-10-02", [porridge]);
    fakeServer(dayView());
    renderDay("today");
    await userEvent.click(await screen.findByRole("button", { name: "Clear copied entries" }));
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
  });

  it("copies from a day too old to add to, but pastes only where an entry may go", async () => {
    copyEntries("2026-10-02", [porridge]);
    fakeServer(dayView({ date: "2026-09-20", entries: [entry({ id: "old", date: "2026-09-20" })] }));
    renderDay("2026-09-20");
    expect(await screen.findByRole("button", { name: "Copy entries" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Paste/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add manually" })).not.toBeInTheDocument();
  });

  it("offers no copying on a day with nothing logged", async () => {
    fakeServer(dayView());
    renderDay("today");
    expect(await screen.findByRole("button", { name: "+ Add manually" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy entries" })).not.toBeInTheDocument();
  });
});
