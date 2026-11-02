import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Memory, MemoriesView, Profile, ProfileView } from "../shared.ts";
import { storedProfile } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const CALCULATED = { kcal: 2150, protein_g: 148, carbs_g: 215, fat_g: 72, fibre_g: 30 };
const memory = (overrides: Partial<Memory>): Memory => ({
  id: "0000000a", kind: "preference", text: "Hates coriander", expires_on: null, source: "coach", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", ...overrides,
});

function serve(profile: Profile, memories: Memory[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch = mockFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === "/api/profile") {
      const body = method === "PUT" ? (JSON.parse(String(init?.body)) as Profile) : profile;
      return jsonResponse({ profile: body, calculated: CALCULATED, companion_locked_until: null } satisfies ProfileView);
    }
    if (url === "/api/memories" && method === "GET") return jsonResponse({ enabled: profile.memories === "on", memories } satisfies MemoriesView);
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (url.startsWith("/api/memories/")) return jsonResponse(memory({ ...(JSON.parse(String(init?.body)) as Partial<Memory>), id: url.slice(-8) }));
    return jsonResponse({});
  });
  return { calls, fetch };
}

const open = () => renderWithProviders(<SettingsPage />, { route: "/settings/memories", path: "/settings/*" });

describe("What Zabaione remembers", () => {
  it("lists the memories by kind, with a plan's last day and who added it", async () => {
    serve(storedProfile(), [
      memory({}),
      memory({ id: "0000000b", kind: "plan", text: "Half marathon", expires_on: "2027-04-12", source: "person" }),
    ]);
    open();
    expect(await screen.findByText("Hates coriander")).toBeInTheDocument();
    expect(screen.getByText("Likes and dislikes").closest("section")).toHaveTextContent("Hates coriander");
    expect(screen.getByText("Plans").closest("section")).toHaveTextContent("until 12 April · added by you");
    expect(screen.getByRole("switch", { name: "Remember things from our chats" })).toBeChecked();
  });

  it("adds, edits and deletes a memory", async () => {
    const { calls } = serve(storedProfile(), [memory({})]);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Add a memory" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Add a memory" }), "Gym Tue/Thu 7am");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "routine");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls[0]).toMatchObject({ method: "PUT", body: { kind: "routine", text: "Gym Tue/Thu 7am", expires_on: null } }));
    expect(calls[0].url).toMatch(/^\/api\/memories\/[0-9a-f]{8}$/);

    await userEvent.click(screen.getByRole("button", { name: /Hates coriander/ }));
    const box = screen.getByRole("textbox", { name: "Add a memory" });
    await userEvent.clear(box);
    await userEvent.type(box, "Hates coriander and dill");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls[1]).toMatchObject({ method: "PUT", url: "/api/memories/0000000a", body: { text: "Hates coriander and dill" } }));

    await userEvent.click(screen.getByRole("button", { name: /Hates coriander/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls[2]).toMatchObject({ method: "DELETE", url: "/api/memories/0000000a" }));
  });

  it("switches memories off and forgets everything after asking", async () => {
    const { calls } = serve(storedProfile(), [memory({})]);
    open();
    await screen.findByText("Hates coriander");
    await userEvent.click(screen.getByRole("switch", { name: "Remember things from our chats" }));
    await waitFor(() => expect(calls[0]).toMatchObject({ method: "PUT", url: "/api/profile", body: { memories: "off" } }));
    vi.stubGlobal("confirm", () => true);
    await userEvent.click(screen.getByRole("button", { name: "Forget everything" }));
    await waitFor(() => expect(calls[1]).toMatchObject({ method: "DELETE", url: "/api/memories" }));
  });

  it("says when there is nothing yet, and shows Off on the Settings row", async () => {
    serve(storedProfile({ memories: "off" }), []);
    open();
    expect(await screen.findByText("Nothing yet. Zabaione adds things as you chat, or you can add one yourself.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forget everything" })).toBeNull();
  });
});

describe("the Settings row", () => {
  it("opens the list, and says Off when memories are off", async () => {
    serve(storedProfile({ memories: "off" }), []);
    renderWithProviders(<SettingsPage />, { route: "/settings", path: "/settings/*" });
    const row = await screen.findByRole("link", { name: /What Zabaione remembers/ });
    expect(row).toHaveAttribute("href", "/settings/memories");
    expect(within(row).getByText("Off")).toBeInTheDocument();
  });
});
