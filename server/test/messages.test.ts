import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { processMessage } from "../src/coach/process.ts";
import { coachTurns } from "../src/db/schema.ts";
import { failInterrupted, getMessage, insertUserMessage } from "../src/messages/messages.ts";
import { getPhoto, savePhoto } from "../src/photos/photos.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { fakeAi, hangUntilAborted, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { NOW, TOOL_EGGS, logItemsInput, makeProfile, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";
import { fakeJpeg } from "./images.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function appWith(steps: FakeStep[] | null, coachBudgetMs?: number) {
  const ai = steps ? fakeAi(steps) : null;
  ctx = await testApp({ ai, coachBudgetMs });
  saveProfile(ctx.db, makeProfile(), NOW.toISOString());
  return { app: ctx, ai };
}

function send(app: TestApp, text: string, id = randomUUID(), sentAt = "2026-10-03T11:58:00.000Z") {
  return app.app.inject({ method: "POST", url: "/api/messages", headers: app.headers, payload: { id, sent_at: sentAt, text } });
}

function retry(app: TestApp, id: string) {
  return app.app.inject({ method: "POST", url: `/api/messages/${id}/retry`, headers: app.headers });
}

function addPhoto(app: TestApp): string {
  const saved = savePhoto(app.db, app.photoDir, fakeJpeg(8, 6), NOW.toISOString());
  if (!saved.ok) throw new Error("the test photo was refused");
  return saved.photo.id;
}

function sendWith(app: TestApp, body: { id?: string; text?: string; photo_ids?: string[] }) {
  const { id = randomUUID(), ...rest } = body;
  return app.app.inject({
    method: "POST", url: "/api/messages", headers: app.headers,
    payload: { id, sent_at: "2026-10-03T11:58:00.000Z", text: "", photo_ids: [], ...rest },
  });
}

describe("POST /api/messages", () => {
  it("logs what the coach records and returns the reply with the day", async () => {
    const { app, ai } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged 2 scrambled eggs, 180 kcal.")]);
    const res = await send(app, "2 scrambled eggs");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ role: "user", status: "done", date: "2026-10-03", error_code: null });
    expect(body.reply).toMatchObject({ role: "assistant", text: "Logged 2 scrambled eggs, 180 kcal.", reply_to: body.user.id });
    expect(body.day.entries).toHaveLength(1);
    expect(body.day.entries[0]).toMatchObject({ source: "coach", message_id: body.user.id });
    expect(body.reply.cards).toEqual([{ type: "entry", id: body.day.entries[0].id }]);
    expect(body.day.totals.kcal).toBe(180);
    expect(ai?.requests[0].tools.map((t) => t.name)).toEqual(["log_items", "update_entry"]);
    expect(JSON.stringify(ai?.requests[0].messages[0])).toContain("Context for this message");
  });

  it("returns the stored result for a repeated id without asking the coach again", async () => {
    const { app, ai } = await appWith([textReply("Hi!")]);
    const id = randomUUID();
    await send(app, "hello", id);
    const again = await send(app, "hello", id);
    expect(again.statusCode).toBe(200);
    expect(again.json().reply.text).toBe("Hi!");
    expect(ai?.requests).toHaveLength(1);
  });

  it("reports a message that is still being processed", async () => {
    const { app } = await appWith([]);
    const id = randomUUID();
    insertUserMessage(app.db, { id, date: "2026-10-03", text: "x", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    const res = await send(app, "x", id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "in_progress" });
  });

  it("leaves only a failed message when the coach fails, and Retry logs exactly once", async () => {
    const { app } = await appWith([
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      new AiError("api_error", "boom"),
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
    ]);
    const first = await send(app, "2 scrambled eggs");
    expect(first.json().user).toMatchObject({ status: "failed", error_code: "ai_error" });
    expect(first.json().reply).toBeNull();
    expect(first.json().day.entries).toEqual([]);
    expect(app.db.select().from(coachTurns).all()).toEqual([]);

    const retried = await retry(app, first.json().user.id);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().user.status).toBe("done");
    expect(retried.json().day.entries).toHaveLength(1);
  });

  it("fails with ai_unavailable when no API key is configured", async () => {
    const { app } = await appWith(null);
    expect((await send(app, "2 eggs")).json().user).toMatchObject({ status: "failed", error_code: "ai_unavailable" });
  });

  it("fails with timeout when the coach exceeds its budget", async () => {
    const { app } = await appWith([hangUntilAborted()], 50);
    expect((await send(app, "2 eggs")).json().user).toMatchObject({ status: "failed", error_code: "timeout" });
  });

  it("carries the day's conversation forward under the same frozen system prompt", async () => {
    const { app, ai } = await appWith([
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
      textReply("About 1,680 kcal left."),
    ]);
    await send(app, "2 scrambled eggs");
    await send(app, "how much is left?", randomUUID(), "2026-10-03T11:59:00.000Z");
    expect(ai?.requests).toHaveLength(3);
    expect(ai?.requests[2].system).toBe(ai?.requests[0].system);
    // user, tool call, tool result, reply — then the new user turn
    expect(ai?.requests[2].messages).toHaveLength(5);
  });

  it("corrects an entry through update_entry", async () => {
    let entryId = "";
    const { app } = await appWith([
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
      () => toolCall([{ name: "update_entry", input: { entry_id: entryId, foods: [{ ...TOOL_EGGS, name: "3 scrambled eggs", kcal: 270 }], exercises: [] } }]),
      textReply("Updated to 3 eggs."),
    ]);
    const first = await send(app, "2 scrambled eggs");
    entryId = first.json().day.entries[0].id;
    const second = await send(app, "actually it was 3 eggs", randomUUID(), "2026-10-03T11:59:00.000Z");
    expect(second.json().day.entries).toHaveLength(1);
    expect(second.json().day.entries[0]).toMatchObject({ id: entryId, edited: true, foods: [{ name: "3 scrambled eggs", kcal: 270 }] });
    expect(second.json().reply.cards).toEqual([{ type: "entry", id: entryId }]);
  });

  it("refuses messages from the future or from more than a week ago", async () => {
    const { app } = await appWith([]);
    expect((await send(app, "x", randomUUID(), "2026-10-04T12:00:00.000Z")).json()).toEqual({ error: "future_date" });
    expect((await send(app, "x", randomUUID(), "2026-09-20T12:00:00.000Z")).json()).toEqual({ error: "too_old" });
  });
});

describe("POST /api/messages with photos", () => {
  it("attaches the photos to the message, in the order sent", async () => {
    const { app } = await appWith([textReply("Looks like porridge.")]);
    const [a, b] = [addPhoto(app), addPhoto(app)];
    const res = await sendWith(app, { text: "breakfast", photo_ids: [a, b] });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.photo_ids).toEqual([a, b]);
    expect(body.day.messages[0].photo_ids).toEqual([a, b]);
    expect(getPhoto(app.db, a)?.message_id).toBe(body.user.id);
  });

  it("accepts photos without text", async () => {
    const { app } = await appWith([textReply("Noted.")]);
    const res = await sendWith(app, { photo_ids: [addPhoto(app)] });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.text).toBe("");
  });

  it("refuses a message with neither text nor photos", async () => {
    const { app } = await appWith([]);
    const res = await sendWith(app, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
  });

  it("refuses an unknown photo and stores nothing", async () => {
    const { app, ai } = await appWith([]);
    const id = randomUUID();
    const res = await sendWith(app, { id, text: "lunch", photo_ids: ["f".repeat(32)] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "photo_not_found" });
    expect(getMessage(app.db, id)).toBeNull();
    expect(ai?.requests).toHaveLength(0);
  });

  it("refuses a photo that belongs to another message", async () => {
    const { app } = await appWith([textReply("Noted.")]);
    const photo = addPhoto(app);
    await sendWith(app, { photo_ids: [photo] });
    const res = await sendWith(app, { text: "again", photo_ids: [photo] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "photo_taken" });
  });

  it("returns the stored result when the same message and photos arrive again", async () => {
    const { app, ai } = await appWith([textReply("Noted.")]);
    const id = randomUUID();
    const photo = addPhoto(app);
    await sendWith(app, { id, photo_ids: [photo] });
    const again = await sendWith(app, { id, photo_ids: [photo] });
    expect(again.statusCode).toBe(200);
    expect(again.json().user.photo_ids).toEqual([photo]);
    expect(ai?.requests).toHaveLength(1);
  });

  it("leaves the photo free when storing the message fails", async () => {
    const { app } = await appWith([textReply("Noted.")]);
    const photo = addPhoto(app);
    app.db.run(sql.raw("CREATE TRIGGER boom BEFORE INSERT ON messages WHEN NEW.role = 'user' BEGIN SELECT RAISE(ABORT, 'boom'); END"));
    expect((await sendWith(app, { photo_ids: [photo] })).statusCode).toBe(500);
    expect(getPhoto(app.db, photo)?.message_id).toBeNull();
    app.db.run(sql.raw("DROP TRIGGER boom"));
    expect((await sendWith(app, { photo_ids: [photo] })).statusCode).toBe(201);
  });
});

describe("POST /api/messages/:id/retry", () => {
  it("404s for unknown ids and 409s for messages that did not fail", async () => {
    const { app } = await appWith([textReply("Hi")]);
    expect((await retry(app, randomUUID())).statusCode).toBe(404);
    const ok = await send(app, "hello");
    expect((await retry(app, ok.json().user.id)).statusCode).toBe(409);
  });
});

describe("failInterrupted", () => {
  it("marks messages left pending by a restart so they can be retried", async () => {
    const { app } = await appWith([]);
    insertUserMessage(app.db, { id: "m1", date: "2026-10-03", text: "x", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    expect(failInterrupted(app.db)).toBe(1);
    expect(getMessage(app.db, "m1")).toMatchObject({ status: "failed", error_code: "interrupted" });
  });
});

describe("a crash while committing", () => {
  // Each trigger fails one statement of the final commit after the earlier ones have run, so only
  // the transaction can keep the entry, the turns and the reply from surviving a failed message.
  const failures: [string, string][] = [
    ["the reply", "CREATE TRIGGER boom BEFORE INSERT ON messages WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'boom'); END"],
    ["the second turn", "CREATE TRIGGER boom BEFORE INSERT ON coach_turns WHEN NEW.seq = 1 BEGIN SELECT RAISE(ABORT, 'boom'); END"],
    ["the done status", "CREATE TRIGGER boom BEFORE UPDATE ON messages WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'boom'); END"],
  ];
  for (const [what, trigger] of failures) {
    it(`on ${what} leaves only a failed message, and Retry logs exactly once`, async () => {
      const { app } = await appWith([
        toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged."),
        toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged."),
      ]);
      app.db.run(sql.raw(trigger));
      const first = await send(app, "2 scrambled eggs");
      expect(first.statusCode).toBe(201);
      expect(first.json().user).toMatchObject({ status: "failed", error_code: "internal" });
      expect(first.json().reply).toBeNull();
      expect(first.json().day.entries).toEqual([]);
      expect(app.db.select().from(coachTurns).all()).toEqual([]);
      app.db.run(sql.raw("DROP TRIGGER boom"));
      const retried = await retry(app, first.json().user.id);
      expect(retried.json().user).toMatchObject({ status: "done", error_code: null });
      expect(retried.json().day.entries).toHaveLength(1);
      expect(app.db.select().from(coachTurns).all()).toHaveLength(4);
    });
  }
});

describe("the message's day is the local day it was sent (spec 7.5)", () => {
  it("keeps a message typed at 23:55 on its day when it arrives after midnight", async () => {
    // 22:55Z is 23:55 BST on 2 Oct; the server clock reads 13:00 BST on 3 Oct.
    const { app } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    const res = await send(app, "2 scrambled eggs", randomUUID(), "2026-10-02T22:55:00.000Z");
    expect(res.json().user).toMatchObject({ date: "2026-10-02", status: "done" });
    expect(res.json().day).toMatchObject({ date: "2026-10-02", today: "2026-10-03" });
    expect(res.json().day.entries[0]).toMatchObject({ date: "2026-10-02", logged_at: "2026-10-02T22:55:00.000Z" });
  });

  it("uses the profile timezone, not UTC, and allows seven days back but not eight", async () => {
    const { app } = await appWith([textReply("a"), textReply("b")]);
    // 23:30Z on 2 Oct is 00:30 BST on 3 Oct.
    expect((await send(app, "x", randomUUID(), "2026-10-02T23:30:00.000Z")).json().user.date).toBe("2026-10-03");
    // 00:30 BST on 26 Sep is seven days back; 23:59 BST on 25 Sep is eight.
    expect((await send(app, "x", randomUUID(), "2026-09-25T23:30:00.000Z")).statusCode).toBe(201);
    expect((await send(app, "x", randomUUID(), "2026-09-25T22:59:00.000Z")).json()).toEqual({ error: "too_old" });
  });
});

describe("processMessage", () => {
  it("passes Claude's error text on for the log", async () => {
    const { app, ai } = await appWith([new AiError("api_error", "400 invalid_request_error: fallbacks")]);
    insertUserMessage(app.db, { id: "m1", date: "2026-10-03", text: "2 eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    const outcome = await processMessage({ db: app.db, ai, now: () => NOW, budgetMs: 1000 }, "m1");
    expect(outcome).toMatchObject({ outcome: "ai_error", detail: "400 invalid_request_error: fallbacks" });
  });
});

describe("a back-dated coach entry", () => {
  it("appears with today's reply as a linked entry, but is not counted today", async () => {
    const { app } = await appWith([toolCall([{ name: "log_items", input: logItemsInput({ date: "2026-10-02" }) }]), textReply("Logged for yesterday.")]);
    const res = await send(app, "yesterday I had 2 scrambled eggs");
    const day = res.json().day;
    expect(day).toMatchObject({ date: "2026-10-03", entries: [] });
    expect(day.totals.kcal).toBe(0);
    expect(day.linked_entries).toHaveLength(1);
    expect(day.linked_entries[0]).toMatchObject({ date: "2026-10-02", source: "coach", message_id: res.json().user.id });
    expect(res.json().reply.cards).toEqual([{ type: "entry", id: day.linked_entries[0].id }]);
  });
});
