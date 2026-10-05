import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { callsOn, recordRun } from "../src/coach/usage.ts";
import { aiUsage, coachThreads } from "../src/db/schema.ts";
import type { Sql } from "../src/db/types.ts";
import { purgeExpired } from "../src/retention/retention.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { NOW, logItemsInput, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};
const FRIEND = "friend@example.com";
const NO_TOKENS = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
type Headers = Record<string, string>;

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Model calls already made on `date`, as earlier runs would have recorded them. */
function used(sql: Sql, date: string, calls: number) {
  recordRun(sql, { messageId: randomUUID(), date, model: "claude-opus-5-5", calls, usage: NO_TOKENS, nowIso: NOW.toISOString() });
}

/** The owner and a guest, both set up, with the coach answering from `steps` in order. `logLines` turns the app's log on and collects it. */
async function appWith(steps: FakeStep[], timezone?: string, logLines?: string[]) {
  const ai = fakeAi(steps);
  const app = await testApp({ guests: [FRIEND], ai, logLines });
  t = app;
  const guest = await app.headersFor(FRIEND);
  for (const headers of [app.headers, guest]) {
    const res = await app.app.inject({ method: "PUT", url: "/api/profile", headers, payload: { ...PROFILE, ...(timezone ? { timezone } : {}) } });
    expect(res.statusCode).toBe(200);
  }
  return { app, ai, guest };
}

const send = (app: TestApp, headers: Headers, text = "two eggs", sentAt = "2026-10-03T11:58:00.000Z") =>
  app.app.inject({ method: "POST", url: "/api/messages", headers, payload: { id: randomUUID(), sent_at: sentAt, text } });
const retry = (app: TestApp, headers: Headers, id: string) => app.app.inject({ method: "POST", url: `/api/messages/${id}/retry`, headers });

/** The events of a text/event-stream body, comments left out. */
function eventsOf(payload: string) {
  return payload
    .split("\n\n")
    .filter((block) => block.trim() !== "" && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const data = JSON.parse(lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "null");
      return { event, data };
    });
}

describe("the coach's daily cap (2.2 §6)", () => {
  it("refuses a guest at 60 calls, and Retry too, without calling Claude", async () => {
    const { app, ai, guest } = await appWith([]);
    used(app.storeOf(FRIEND).db, "2026-10-03", 60);
    const res = await send(app, guest);
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect((await retry(app, guest, res.json().user.id)).json().user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect(ai.requests).toHaveLength(0);
    // A refusal has no side effects: no conversation thread started for it, and no usage recorded beyond what was already there.
    const theirs = app.storeOf(FRIEND).db;
    expect(theirs.select().from(coachThreads).all()).toEqual([]);
    expect(theirs.select({ calls: aiUsage.calls }).from(aiUsage).all()).toEqual([{ calls: 60 }]);
  });

  it("ends a streamed send with stored and the result, no steps, without calling Claude or logging the message", async () => {
    const lines: string[] = [];
    const { app, ai, guest } = await appWith([], undefined, lines);
    used(app.storeOf(FRIEND).db, "2026-10-03", 60);
    const text = "two eggs and a zebra-crossing-sandwich";
    const res = await send(app, { ...guest, accept: "text/event-stream" }, text);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    const events = eventsOf(res.payload);
    // The coach never started, so there is nothing to follow.
    expect(events.map((e) => e.event)).toEqual(["stored", "result"]);
    expect(events[1].data.user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect(ai.requests).toHaveLength(0);
    // The failure is in the log by its code, so the log is on and capturing; the message and any address are not in it.
    expect(lines.some((line) => line.includes("ai_cap"))).toBe(true);
    const logged = lines.join("");
    expect(logged).not.toContain(text);
    expect(logged).not.toContain("@");
  });

  it("lets a guest through at 59, and that run may finish over the cap", async () => {
    const { app, guest } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    used(app.storeOf(FRIEND).db, "2026-10-03", 59);
    expect((await send(app, guest)).json().user.status).toBe("done");
    expect(callsOn(app.storeOf(FRIEND).db, "2026-10-03")).toBe(61);
  });

  it("holds the owner to 200, and never counts one person's calls against another's", async () => {
    const { app, ai, guest } = await appWith([textReply("Noted."), textReply("Noted.")]);
    used(app.db, "2026-10-03", 199);
    expect((await send(app, app.headers)).json().user.status).toBe("done"); // the owner's 200th call
    expect((await send(app, app.headers)).json().user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect((await send(app, guest)).json().user.status).toBe("done"); // the guest has made none
    expect(ai.requests).toHaveLength(2);
  });

  it("counts a run that failed, and records each run's model, calls and tokens", async () => {
    const { app, guest } = await appWith([
      new AiError("api_error", "overloaded"),
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
    ]);
    const failed = await send(app, guest);
    expect(failed.json().user).toMatchObject({ status: "failed", error_code: "ai_error" });
    expect((await retry(app, guest, failed.json().user.id)).json().user.status).toBe("done");
    const rows = app.storeOf(FRIEND).db.select().from(aiUsage).all();
    expect(rows.map((r) => ({ date: r.date, model: r.model, calls: r.calls, input_tokens: r.input_tokens, output_tokens: r.output_tokens }))).toEqual([
      { date: "2026-10-03", model: null, calls: 1, input_tokens: 0, output_tokens: 0 },
      { date: "2026-10-03", model: "claude-opus-5-5", calls: 2, input_tokens: 200, output_tokens: 40 },
    ]);
    expect(rows.every((r) => r.message_id === failed.json().user.id)).toBe(true);
    expect(callsOn(app.storeOf(FRIEND).db, "2026-10-03")).toBe(3);
  });

  it("counts a back-dated message's calls on the day they are made, not on the message's day", async () => {
    const { app, ai, guest } = await appWith([textReply("Noted.")]);
    const db = app.storeOf(FRIEND).db;
    used(db, "2026-10-03", 59);
    // Sent yesterday by the guest's clock and typed in today: the message belongs to the 2nd, but its call is made on the 3rd.
    const first = await send(app, guest, "two eggs yesterday", "2026-10-02T11:58:00.000Z");
    expect(first.json().user).toMatchObject({ date: "2026-10-02", status: "done" });
    const run = db.select().from(aiUsage).all().filter((row) => row.message_id === first.json().user.id);
    expect(run).toEqual([expect.objectContaining({ date: "2026-10-03", calls: 1 })]);
    expect(callsOn(db, "2026-10-02")).toBe(0);
    expect(callsOn(db, "2026-10-03")).toBe(60);
    // That was today's 60th call, so the next back-dated message is refused.
    const second = await send(app, guest, "a coffee yesterday", "2026-10-02T11:59:00.000Z");
    expect(second.json().user).toMatchObject({ date: "2026-10-02", status: "failed", error_code: "ai_cap" });
    expect(ai.requests).toHaveLength(1);
  });

  it("starts afresh at the person's own local midnight", async () => {
    // 12:00 UTC on 3 October is already 01:00 on the 4th in Auckland.
    const { app, guest } = await appWith([textReply("Noted.")], "Pacific/Auckland");
    used(app.storeOf(FRIEND).db, "2026-10-03", 60);
    expect((await send(app, guest)).json().user.status).toBe("done");
    expect(callsOn(app.storeOf(FRIEND).db, "2026-10-04")).toBe(1);
  });

  it("keeps the count when its message expires", async () => {
    const { app, guest } = await appWith([textReply("Noted.")]);
    await send(app, guest);
    const store = app.storeOf(FRIEND);
    purgeExpired(store.db, store.photoDir, new Date("2026-10-06T12:00:00.000Z"), 48);
    expect((await app.app.inject({ method: "GET", url: "/api/days/2026-10-03", headers: guest })).json().messages).toEqual([]);
    expect(store.db.select().from(aiUsage).all()).toHaveLength(1);
  });
});
