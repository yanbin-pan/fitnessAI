import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { en } from "../i18n/index.tsx";
import { TIP_IDS } from "../shared.ts";
import type { SeenTip } from "../shared.ts";
import { dayView, message, storedProfile } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TodayPage } from "./TodayPage.tsx";

const reply = message({ id: "m2", role: "assistant", status: null, text: "Logged.", created_at: "2026-10-03T08:00:05.000Z" });

/** A stand-in server that keeps the tips it is told were shown. */
function server(seen: SeenTip[] = []) {
  const tips = [...seen];
  const posts: unknown[] = [];
  mockFetch((url, init) => {
    if (url === "/api/tips" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      tips.push({ ...body, date: "2026-10-03", seen_at: "2026-10-03T09:00:00.000Z" });
      return jsonResponse({ tips });
    }
    if (url === "/api/tips") return jsonResponse({ tips });
    return jsonResponse(dayView({ messages: [reply] }));
  });
  return posts;
}

function renderToday() {
  const result = renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
  result.client.setQueryData(["profile"], { profile: storedProfile(), calculated: { kcal: 2300, protein_g: 144, carbs_g: 260, fat_g: 70, fibre_g: 30 } });
  return result;
}

describe("TodayPage: the companion's tips", () => {
  it("glows while a tip is due, and a tap puts the tip in the chat instead of opening the window", async () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(9);
    const posts = server();
    renderToday();
    const pet = await screen.findByRole("button", { name: `Zabaione, ${en.tips.label}` });
    expect(screen.getByTestId("pet-glow")).toBeInTheDocument();
    await userEvent.click(pet);
    expect(await screen.findByText(en.tips.items["shared-plate"])).toBeInTheDocument();
    expect(posts).toEqual([{ id: "shared-plate", vars: {} }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    // One a morning: the glow is gone, and the next tap opens the window as before.
    await waitFor(() => expect(screen.queryByTestId("pet-glow")).toBeNull());
    await userEvent.click(screen.getAllByRole("button", { name: /^Zabaione, Okay/ }).at(-1)!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("doesn't glow once every tip has been seen", async () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(20);
    server(TIP_IDS.map((id) => ({ id, date: "2026-09-01", seen_at: "2026-09-01T09:00:00.000Z", vars: {} })));
    renderToday();
    expect((await screen.findAllByRole("button", { name: /^Zabaione, Okay/ })).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("pet-glow")).toBeNull();
  });
});
