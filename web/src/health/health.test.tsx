import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import type {
  ChatMessageView, DocumentReadView, DocumentView, FactView, HealthChatView, HealthView, MarkerFoodView, ObservationView, SuggestionView,
} from "../shared.ts";
import { HealthDataSettings } from "./CoachView.tsx";
import { HealthRoutes } from "./HealthRoutes.tsx";
import { watched } from "./HealthHome.tsx";

const AT = "2026-10-12T08:00:00.000Z";
const empty: HealthView = { consented_at: AT, facts: [], documents: [], trends: [], suggestions: [] };

const fact = (overrides: Partial<FactView>): FactView => ({
  id: "f", kind: "condition", code: null, label: "Gout", detail: "", level: null, started_on: null, ended_on: null, status: "active", shared: true,
  document_id: null, created_at: AT, ...overrides,
});
const result = (overrides: Partial<ObservationView>): ObservationView => ({
  id: "o", code: "ldl", name: "LDL cholesterol", printed_name: "Colesterol LDL", value: 4.1, text_value: "", unit: "mmol/L", ref_low: null, ref_high: 3, flag: "high",
  ...overrides,
});
const blood: DocumentView = {
  id: "d1", kind: "lab", taken_on: "2026-09-12", title: "", source: "Laboratorio Echevarne", language: "Spanish", summary: "", created_at: AT,
  observations: [result({}), result({ id: "h", code: "hdl", name: "HDL cholesterol", printed_name: "", value: 1.3, ref_low: 1, ref_high: null, flag: "normal" })],
};
const mri: DocumentView = {
  id: "d2", kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI, left", source: "Radiologie am Rhein", language: "German",
  summary: "Small tear of the medial meniscus. No fracture.", created_at: AT, observations: [],
};
const suggestion = (overrides: Partial<SuggestionView>): SuggestionView => ({
  id: "s1", status: "pending", fact_id: null, document_id: null, message_id: "c1",
  fact: { kind: "intolerance", code: "lactose_intolerance", label: "Lactose intolerance", detail: "hard cheese is fine", level: "limit", started_on: null, ended_on: null },
  ...overrides,
});

const full: HealthView = {
  ...empty,
  facts: [
    fact({ id: "f1", code: "prediabetes", label: "Prediabetes" }),
    fact({ id: "f2", kind: "injury", label: "Left knee, meniscus tear", detail: "No deep squats", document_id: "d2" }),
    fact({ id: "f3", kind: "medication", label: "Atorvastatin", detail: "10 mg once a day" }),
    fact({ id: "f4", kind: "diet", code: "vegetarian", label: "Vegetarian" }),
    fact({ id: "f5", kind: "allergy", label: "Peanuts", level: "never" }),
    fact({ id: "f6", kind: "target", label: "Saturated fat under 15 g", document_id: "d1" }),
  ],
  documents: [blood, mri],
  trends: [
    { key: "ldl", code: "ldl", name: "LDL cholesterol", unit: "mmol/L", ref_low: null, ref_high: 3, points: [{ taken_on: "2026-03-04", value: 3.6, flag: "high" }, { taken_on: "2026-09-12", value: 4.1, flag: "high" }] },
    { key: "hdl", code: "hdl", name: "HDL cholesterol", unit: "mmol/L", ref_low: 1, ref_high: null, points: [{ taken_on: "2026-09-12", value: 1.3, flag: "normal" }] },
  ],
  suggestions: [suggestion({}), suggestion({ id: "s2", fact: { kind: "injury", code: null, label: "Lower back pain", detail: "", level: null, started_on: null, ended_on: null } })],
};

vi.mock("../photos/prepare.ts", () => ({
  preparePhoto: vi.fn(async () => ({ blob: new Blob(["resized"], { type: "image/jpeg" }), width: 1568, height: 1176 })),
}));

/** A JSON body as sent, or undefined for none or a photo's bytes. */
function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

function serve(routes: Record<string, unknown>, calls: { method: string; url: string; body: unknown }[] = []) {
  return mockFetch((url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: bodyOf(init) });
    const key = `${method} ${url}`;
    const found = key in routes ? routes[key] : routes[url];
    if (found === undefined) return jsonResponse({ error: "not_found" }, 404);
    return typeof found === "function" ? (found as (body: unknown) => Response)(bodyOf(init)) : jsonResponse(found);
  });
}

const renderAt = (route: string) => renderWithProviders(<HealthRoutes />, { route, path: "/health/*" });

describe("the Health home", () => {
  it("asks for consent before anything else", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({ "GET /api/records": { ...empty, consented_at: null }, "POST /api/records/consent": empty }, calls);
    renderAt("/health");
    await userEvent.click(await screen.findByRole("button", { name: "Agree and continue" }));
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/records/consent")).toBe(true);
  });

  it("shows what waits for an OK, the profile, what the coach watches and the latest records", async () => {
    serve({ "/api/records": full });
    renderAt("/health");
    expect(await screen.findByText("Waiting for your OK")).toBeInTheDocument();
    expect(screen.getByText("Lactose intolerance · Lower back pain")).toBeInTheDocument();
    const profile = screen.getByRole("region", { name: "Your health profile" });
    expect(within(profile).getByRole("link", { name: /Conditions.*Prediabetes/ })).toHaveAttribute("href", "/health/profile/conditions");
    expect(within(profile).getByRole("link", { name: /Injuries.*Left knee, meniscus tear · No deep squats/ })).toBeInTheDocument();
    expect(within(profile).getByRole("link", { name: /Diet & allergies.*Vegetarian.*Peanuts.*1 target set/ })).toHaveAttribute("href", "/health/diet");
    expect(screen.getByRole("link", { name: /LDL cholesterol went from 3.6 to 4.1 since Mar 2026/ })).toHaveAttribute("href", "/health/markers/ldl");
    const records = screen.getByRole("region", { name: "Records" });
    expect(within(records).getByRole("link", { name: /Blood test.*12 Sept 2026 · Spanish · 1 out of range/ })).toHaveAttribute("href", "/health/records/d1");
    expect(within(records).getByRole("link", { name: /Knee MRI, left/ })).toBeInTheDocument();
  });

  it("keeps reading a record after you leave the tab, and has it ready to check when you come back", async () => {
    const read: DocumentReadView = {
      kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI, left", source: "Radiologie am Rhein", language: "German",
      summary: "", observations: [], facts: [],
    };
    let answer: (res: Response) => void = () => {};
    serve({
      "GET /api/records": empty,
      "POST /api/photos": { id: "a".repeat(32) },
      "POST /api/records/read": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const away = renderAt("/health");
    await userEvent.upload(await screen.findByLabelText("Upload file"), new File(["x"], "page.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Reading your record…")).toBeInTheDocument();
    away.unmount();
    answer(jsonResponse(read));
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderAt("/health");
    expect(await screen.findByRole("dialog", { name: "Check what I read" })).toBeInTheDocument();
  });

  it("reads photos of a record and saves it once checked, with the facts ticked and the rest left as suggestions", async () => {
    const read: DocumentReadView = {
      kind: "imaging", taken_on: "2026-06-18", title: "Knee MRI, left", source: "Radiologie am Rhein", language: "German",
      summary: "Small tear of the medial meniscus.", observations: [],
      facts: [
        { kind: "injury", code: null, label: "Left knee, meniscus tear", detail: "", level: null, started_on: null, ended_on: null },
        { kind: "note", code: null, label: "Physio advised", detail: "", level: null, started_on: null, ended_on: null },
      ],
    };
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({
      "GET /api/records": empty,
      "POST /api/photos": { id: "a".repeat(32) },
      "POST /api/records/read": read,
      "POST /api/records/documents": { ...empty, documents: [mri] },
    }, calls);
    renderAt("/health");
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "page.jpg", { type: "image/jpeg" });
    await userEvent.upload(await screen.findByLabelText("Upload file"), file);
    const sheet = await screen.findByRole("dialog", { name: "Check what I read" });
    expect(within(sheet).getByText("Written in German, shown in your language. The original wording is kept.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /Physio advised/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/records/documents")).toBe(true));
    const saved = calls.find((c) => c.url === "/api/records/documents")!.body as Record<string, unknown>;
    expect(saved).toMatchObject({ kind: "imaging", title: "Knee MRI, left", summary: "Small tear of the medial meniscus.", message_id: null });
    expect((saved.facts as { label: string }[]).map((f) => f.label)).toEqual(["Left knee, meniscus tear"]);
    expect((saved.suggestions as { label: string }[]).map((f) => f.label)).toEqual(["Physio advised"]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/health/records/d2"));
  });

  it("watches the latest result furthest outside its range", () => {
    expect(watched(full.trends)?.key).toBe("ldl");
    expect(watched([full.trends[1]!])).toBeNull();
  });
});

describe("the Health chat", () => {
  const coach = (overrides: Partial<ChatMessageView>): ChatMessageView => ({
    id: "c1", role: "coach", text: "Sorry about your back. Shall I add these to your profile?", photos: 0, created_at: AT,
    suggestions: [], options: [], read: null, saved_document_id: null, ...overrides,
  });
  const user: ChatMessageView = { ...coach({}), id: "u1", role: "user", text: "I'm lactose intolerant and my back hurts" };

  it("sends a sentence typed on the home, and adds the proposals the person keeps", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const chat: HealthChatView = {
      messages: [user, coach({ suggestions: [suggestion({}), suggestion({ id: "s2", fact: { kind: "injury", code: null, label: "Lower back pain", detail: "no heavy deadlifts", level: null, started_on: null, ended_on: null } })], options: ["Bending forward", "Leaning back"] })],
    };
    serve({
      "GET /api/records": empty,
      "GET /api/records/chat": { messages: [] },
      "POST /api/records/chat": chat,
      "POST /api/records/suggestions/s1/accept": suggestion({ status: "added" }),
    }, calls);
    renderWithProviders(<HealthRoutes />, { route: "/health", path: "/health/*" });
    await userEvent.type(await screen.findByRole("textbox", { name: "Tell your coach" }), "I'm lactose intolerant and my back hurts");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Add to your profile?")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST" && c.url === "/api/records/chat")!.body).toMatchObject({ text: "I'm lactose intolerant and my back hurts", photo_ids: [] });
    expect(screen.getByRole("button", { name: "Bending forward" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Lower back pain/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add to profile" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/records/suggestions/s1/accept")).toBe(true));
    expect(calls.some((c) => c.url.includes("/s2/"))).toBe(false);
  });

  it("shows added proposals with Undo, and a read record to check and save", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const read: DocumentReadView = { kind: "lab", taken_on: "2026-09-12", title: "", source: "Echevarne", language: "Spanish", summary: "", observations: [blood.observations[0]!], facts: [] };
    serve({
      "GET /api/records": empty,
      "GET /api/records/chat": { messages: [user, coach({ suggestions: [suggestion({ status: "added", fact_id: "f9" })] }), coach({ id: "c2", text: "", read })] },
      "POST /api/records/suggestions/s1/undo": suggestion({}),
    }, calls);
    renderAt("/health/chat");
    expect(await screen.findByText("You added Lactose intolerance to Diet & allergies")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/records/suggestions/s1/undo")).toBe(true));
    expect(screen.getByText("I read your blood test: 1 result.")).toBeInTheDocument();
    expect(screen.getByText("Out of range: LDL cholesterol.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check and save" }));
    expect(await screen.findByRole("dialog", { name: "Check what I read" })).toBeInTheDocument();
  });
});

describe("a record", () => {
  it("shows results outside the range first, how they moved, and the coach's suggestions to add", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({
      "GET /api/records": { ...full, suggestions: [suggestion({ id: "s3", message_id: null, document_id: "d1", fact: { kind: "condition", code: "prediabetes", label: "Prediabetes", detail: "", level: null, started_on: null, ended_on: null } })] },
      "POST /api/records/suggestions/s3/accept": suggestion({ status: "added" }),
    }, calls);
    renderAt("/health/records/d1");
    expect(await screen.findByRole("heading", { name: "Blood test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Out of range · 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /LDL cholesterol.*4\.1.*High · normal < 3.*Mar 2026 3\.6 → 4\.1/ })).toHaveAttribute("href", "/health/markers/ldl");
    expect(screen.queryByText("HDL cholesterol")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All · 2" }));
    expect(screen.getByText("HDL cholesterol")).toBeInTheDocument();
    expect(screen.getByText("Saturated fat under 15 g")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/records/suggestions/s3/accept")).toBe(true));
  });

  it("shows a scan's summary", async () => {
    serve({ "GET /api/records": full });
    renderAt("/health/records/d2");
    expect(await screen.findByText("Small tear of the medial meniscus. No fracture.")).toBeInTheDocument();
    expect(screen.getByText("Left knee, meniscus tear")).toBeInTheDocument();
  });
});

describe("a marker beside the food log", () => {
  it("charts both and names where the nutrient comes from", async () => {
    const marker: MarkerFoodView = {
      trend: full.trends[0]!,
      nutrient: { key: "saturated_fat_g", unit: "g", months: [{ month: "2026-03", average: 17, days: 20 }, { month: "2026-09", average: 23, days: 25 }], sources: [{ name: "Cheese", share: 0.38 }] },
    };
    serve({ "GET /api/records": full, "/api/records/markers/ldl": marker });
    renderAt("/health/markers/ldl");
    expect(await screen.findByRole("img", { name: /LDL cholesterol: Mar 2026 3.6, Sept 2026 4.1; normal < 3/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Saturated fat: Mar 2026 17 g, Sept 2026 23 g/ })).toBeInTheDocument();
    expect(screen.getByText("Cheese")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
  });
});

describe("Diet & allergies", () => {
  it("switches the way of eating, one pattern at a time", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({ "GET /api/records": full, "DELETE /api/records/facts/f4": () => new Response(null, { status: 204 }), "POST /api/records/facts": fact({}) }, calls);
    renderAt("/health/diet");
    expect(await screen.findByRole("button", { name: "Vegetarian" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Edit Peanuts/ })).toHaveTextContent("Never");
    expect(screen.getByText("From a record of 12 Sept 2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Vegan" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/records/facts")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")!.url).toBe("/api/records/facts/f4");
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ kind: "diet", code: "vegan", label: "Vegan" });
  });

  it("adds a food to watch with its level", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({ "GET /api/records": empty, "POST /api/records/facts": fact({}) }, calls);
    renderAt("/health/diet");
    await userEvent.click((await screen.findAllByRole("button", { name: "Add" }))[0]!);
    const sheet = screen.getByRole("dialog", { name: "Food" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Name" }), "Mushrooms");
    await userEvent.click(within(sheet).getByRole("radio", { name: "Never" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ kind: "food", label: "Mushrooms", level: "never", shared: true }));
  });
});

describe("what the coach sees", () => {
  it("hides a fact from the coach with its switch", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({ "GET /api/records": full, "PUT /api/records/facts/f3": fact({ id: "f3", shared: false }) }, calls);
    renderAt("/health/coach");
    expect(await screen.findByText(/Prediabetes · Left knee, meniscus tear \(No deep squats\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Let the coach see Atorvastatin" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ kind: "medication", label: "Atorvastatin", shared: false }));
    expect(screen.getByRole("link", { name: "Export all" })).toHaveAttribute("href", "/api/records/export");
  });

  it("offers to delete everything from Settings once there is something", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    serve({ "GET /api/records": full, "DELETE /api/records": () => new Response(null, { status: 204 }) }, calls);
    vi.stubGlobal("confirm", () => true);
    renderWithProviders(<HealthDataSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete my health data" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/records")).toBe(true));
  });
});
