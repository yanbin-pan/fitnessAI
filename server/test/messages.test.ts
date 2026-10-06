import { randomUUID } from "node:crypto";
import http from "node:http";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { processMessage } from "../src/coach/process.ts";
import { coachTurns, entries, messages } from "../src/db/schema.ts";
import { failInterrupted, getMessage, getReply, insertUserMessage } from "../src/messages/messages.ts";
import { getPhoto, savePhoto } from "../src/photos/photos.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { fakeAi, hangUntilAborted, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { NOW, TOOL_EGGS, logItemsInput, makeProfile, tempDir, testApp } from "./helpers.ts";
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

function streamed(app: TestApp, body: { id?: string; text?: string; photo_ids?: string[] }) {
  const { id = randomUUID(), ...rest } = body;
  return app.app.inject({
    method: "POST", url: "/api/messages", headers: { ...app.headers, accept: "text/event-stream" },
    payload: { id, sent_at: "2026-10-03T11:58:00.000Z", text: "", photo_ids: [], ...rest },
  });
}

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

  it("refuses a batch with one unknown photo, and leaves the known one free", async () => {
    const { app, ai } = await appWith([]);
    const free = addPhoto(app);
    const id = randomUUID();
    const res = await sendWith(app, { id, text: "lunch", photo_ids: [free, "f".repeat(32)] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "photo_not_found" });
    expect(getPhoto(app.db, free)?.message_id).toBeNull();
    expect(getMessage(app.db, id)).toBeNull();
    expect(ai?.requests).toHaveLength(0);
  });

  it("refuses a photo that belongs to another message, stores nothing, and leaves the photo with the first", async () => {
    const { app, ai } = await appWith([textReply("Noted.")]);
    const photo = addPhoto(app);
    const first = await sendWith(app, { photo_ids: [photo] });
    const id = randomUUID();
    const res = await sendWith(app, { id, text: "again", photo_ids: [photo] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "photo_taken" });
    expect(getMessage(app.db, id)).toBeNull();
    expect(app.db.select({ id: messages.id }).from(messages).all()).toHaveLength(2); // the first message and its reply
    expect(getPhoto(app.db, photo)?.message_id).toBe(first.json().user.id);
    expect(ai?.requests).toHaveLength(1);
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

describe("POST /api/messages, streamed (spec §6.3)", () => {
  it("streams stored, then what the coach is doing, then the result", async () => {
    const { app } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged 2 scrambled eggs, 180 kcal.")]);
    const res = await streamed(app, { text: "2 scrambled eggs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    const events = eventsOf(res.payload);
    expect(events.map((e) => e.event)).toEqual(["stored", "step", "step", "step", "result"]);
    expect(events[0].data.day.messages).toEqual([expect.objectContaining({ text: "2 scrambled eggs", status: "pending" })]);
    expect(events.slice(1, 4).map((e) => e.data.text)).toEqual(["Thinking…", "Logging scrambled eggs…", "Writing a reply…"]);
    expect(events[4].data.user).toMatchObject({ status: "done" });
    expect(events[4].data.reply.text).toBe("Logged 2 scrambled eggs, 180 kcal.");
    expect(events[4].data.day.entries).toHaveLength(1);
  });

  it("looks at the photo, or the photos, first", async () => {
    const { app } = await appWith([textReply("A plate."), textReply("Two plates.")]);
    expect(eventsOf((await streamed(app, { photo_ids: [addPhoto(app)] })).payload)[1]).toEqual({ event: "step", data: { text: "Looking at your photo…" } });
    expect(eventsOf((await streamed(app, { photo_ids: [addPhoto(app), addPhoto(app)] })).payload)[1]).toEqual({ event: "step", data: { text: "Looking at your photos…" } });
  });

  it("ends a failed message with its result", async () => {
    const { app } = await appWith([new AiError("api_error", "boom")]);
    const events = eventsOf((await streamed(app, { text: "hello" })).payload);
    expect(events.map((e) => e.event)).toEqual(["stored", "step", "result"]);
    expect(events[2].data.user).toMatchObject({ status: "failed", error_code: "ai_error" });
  });

  it("answers a refusal before storing, and a finished repeat, with plain JSON", async () => {
    const { app } = await appWith([textReply("Hi!")]);
    const refused = await streamed(app, { photo_ids: ["0".repeat(32)] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: "photo_not_found" });
    const id = randomUUID();
    await streamed(app, { id, text: "hello" });
    const again = await streamed(app, { id, text: "hello" });
    expect(again.statusCode).toBe(200);
    expect(again.headers["content-type"]).toContain("application/json");
    expect(again.json().reply.text).toBe("Hi!");
  });

  it("answers every other refusal before storing as plain JSON too, for a send and for a Retry", async () => {
    const { app } = await appWith([textReply("Hi!"), textReply("Noted.")]);
    const finished = randomUUID();
    await streamed(app, { id: finished, text: "hello" });
    const photo = addPhoto(app);
    await streamed(app, { photo_ids: [photo] });
    const pending = randomUUID();
    insertUserMessage(app.db, { id: pending, date: "2026-10-03", text: "x", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });

    const post = (url: string, payload?: object) => app.app.inject({ method: "POST", url, headers: { ...app.headers, accept: "text/event-stream" }, payload });
    const message = (overrides: object) => ({ id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", text: "x", photo_ids: [], ...overrides });
    const answeredAsJson = (what: string, res: Awaited<ReturnType<typeof post>>, status: number, error: string) => {
      expect(res.statusCode, what).toBe(status);
      expect(res.headers["content-type"], what).toContain("application/json");
      expect(res.json().error, what).toBe(error);
    };
    answeredAsJson("a bad body", await post("/api/messages", { id: "nope" }), 400, "invalid_request");
    answeredAsJson("a message from the future", await post("/api/messages", message({ sent_at: "2026-10-04T12:00:00.000Z" })), 400, "future_date");
    answeredAsJson("a message from too long ago", await post("/api/messages", message({ sent_at: "2026-09-20T12:00:00.000Z" })), 400, "too_old");
    answeredAsJson("a message still being processed", await post("/api/messages", message({ id: pending })), 409, "in_progress");
    answeredAsJson("a photo another message has", await post("/api/messages", message({ photo_ids: [photo] })), 409, "photo_taken");
    answeredAsJson("a Retry of an unknown message", await post(`/api/messages/${randomUUID()}/retry`), 404, "not_found");
    answeredAsJson("a Retry of a message that did not fail", await post(`/api/messages/${finished}/retry`), 409, "not_failed");
  });

  it("answers no_profile as plain JSON too", async () => {
    ctx = await testApp({ ai: fakeAi([]) });
    const res = await streamed(ctx, { text: "hello" });
    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({ error: "no_profile" });
  });

  it("keeps the connection open while the coach thinks", async () => {
    const slow: FakeStep = () => new Promise((resolve) => setTimeout(() => resolve(textReply("Done.")), 60));
    ctx = await testApp({ ai: fakeAi([slow]), streamKeepAliveMs: 10 });
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    const res = await streamed(ctx, { text: "hello" });
    expect(res.payload).toContain(": keep-alive\n\n");
    expect(eventsOf(res.payload).at(-1)?.event).toBe("result");
  });

  it("streams a Retry the same way", async () => {
    const { app } = await appWith([new AiError("api_error", "boom"), textReply("Back again.")]);
    const id = randomUUID();
    await streamed(app, { id, text: "hello" });
    const res = await app.app.inject({ method: "POST", url: `/api/messages/${id}/retry`, headers: { ...app.headers, accept: "text/event-stream" } });
    const events = eventsOf(res.payload);
    expect(events.map((e) => e.event)).toEqual(["stored", "step", "result"]);
    expect(events[0].data.day.messages[0]).toMatchObject({ id, status: "pending" });
    expect(events[2].data.reply.text).toBe("Back again.");
  });

  it("never writes a step to the log", async () => {
    const logLines: string[] = [];
    ctx = await testApp({ ai: fakeAi([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]), logLines });
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    await streamed(ctx, { text: "2 scrambled eggs" });
    expect(logLines.join("")).not.toMatch(/scrambled/i);
  });

  it("finishes and commits when the phone goes away mid-stream", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held: FakeStep = async () => {
      await gate;
      return toolCall([{ name: "log_items", input: logItemsInput() }]);
    };
    ctx = await testApp({ ai: fakeAi([held, textReply("Logged 2 scrambled eggs, 180 kcal.")]) });
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    const live = ctx;
    const port = new URL(await live.app.listen({ host: "127.0.0.1", port: 0 })).port;
    const id = randomUUID();
    // A real connection, which the phone drops as soon as the first event has come.
    await new Promise<void>((resolve) => {
      const req = http.request(
        { agent: false, host: "127.0.0.1", port, method: "POST", path: "/api/messages", headers: { ...live.headers, accept: "text/event-stream", "content-type": "application/json" } },
        (res) => {
          res.on("error", () => {});
          res.once("data", () => {
            req.destroy();
            resolve();
          });
        },
      );
      req.on("error", () => {});
      req.end(JSON.stringify({ id, sent_at: "2026-10-03T11:58:00.000Z", text: "2 scrambled eggs", photo_ids: [] }));
    });
    const connections = () => new Promise<number>((resolve) => live.app.server.getConnections((_err, count) => resolve(count)));
    await vi.waitFor(async () => expect(await connections()).toBe(0), { timeout: 3000 });
    // Nobody is listening, and the coach is still at work.
    expect(getMessage(live.db, id)?.status).toBe("pending");
    release();
    await vi.waitFor(() => expect(getMessage(live.db, id)?.status).toBe("done"), { timeout: 3000 });
    expect(getReply(live.db, id)?.text).toBe("Logged 2 scrambled eggs, 180 kcal.");
    expect(live.db.select().from(entries).all()).toHaveLength(1);
  });

  it("ends the stream, and the server carries on, when even recording a failure fails", async () => {
    const { app } = await appWith([new AiError("api_error", "boom")]);
    // The coach fails, and then the database refuses to record that it failed. Once the stream has
    // begun Fastify can no longer answer an error (its headers are out), so a throw here would
    // reach the process instead of ending the response.
    app.db.run(sql.raw("CREATE TRIGGER boom BEFORE UPDATE ON messages WHEN NEW.status = 'failed' BEGIN SELECT RAISE(ABORT, 'boom'); END"));
    const res = await streamed(app, { text: "hello" });
    expect(res.statusCode).toBe(200);
    expect(eventsOf(res.payload).map((e) => e.event)).toEqual(["stored", "step"]);
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

  it("uses the profile timezone, not UTC, and allows the chat window's three days back but not four", async () => {
    const { app } = await appWith([textReply("a"), textReply("b")]);
    // 23:30Z on 2 Oct is 00:30 BST on 3 Oct.
    expect((await send(app, "x", randomUUID(), "2026-10-02T23:30:00.000Z")).json().user.date).toBe("2026-10-03");
    // 00:30 BST on 30 Sep is three days back; 23:59 BST on 29 Sep is four.
    expect((await send(app, "x", randomUUID(), "2026-09-29T23:30:00.000Z")).statusCode).toBe(201);
    expect((await send(app, "x", randomUUID(), "2026-09-29T22:59:00.000Z")).json()).toEqual({ error: "too_old" });
  });
});

describe("processMessage", () => {
  it("passes Claude's error text on for the log", async () => {
    const { app, ai } = await appWith([new AiError("api_error", "400 invalid_request_error: fallbacks")]);
    insertUserMessage(app.db, { id: "m1", date: "2026-10-03", text: "2 eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    const outcome = await processMessage({ db: app.db, ai, now: () => NOW, budgetMs: 1000, photoDir: tempDir(), dailyCallCap: 200 }, "m1");
    expect(outcome).toMatchObject({ outcome: "ai_error", detail: "400 invalid_request_error: fallbacks" });
  });

  it("goes on to the end, and still tells every step, when whoever hears the steps throws", async () => {
    const { app, ai } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    insertUserMessage(app.db, { id: "m1", date: "2026-10-03", text: "2 eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    const heard: string[] = [];
    const onStep = (text: string) => {
      heard.push(text);
      throw new Error("the phone has gone");
    };
    const outcome = await processMessage({ db: app.db, ai, now: () => NOW, budgetMs: 1000, photoDir: tempDir(), dailyCallCap: 200, onStep }, "m1");
    expect(outcome.outcome).toBe("done");
    expect(heard).toEqual(["Thinking…", "Logging scrambled eggs…", "Writing a reply…"]);
    expect(getMessage(app.db, "m1")).toMatchObject({ status: "done" });
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

describe("chatting on an earlier day (spec §6.6)", () => {
  /** The context block that opens the request's last user turn. */
  const contextOf = (request: { messages: { content: unknown }[] }) => {
    const [first] = request.messages.at(-1)?.content as { text: string }[];
    return JSON.parse(first.text.slice(first.text.indexOf("{"))) as Record<string, unknown>;
  };
  const sendOn = (app: TestApp, date: string, text = "2 scrambled eggs") =>
    app.app.inject({ method: "POST", url: "/api/messages", headers: app.headers, payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", date, text } });

  it("puts the message and what the coach logs on the day open in the app, with that day in the coach's context", async () => {
    const { app, ai } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    const res = await sendOn(app, "2026-09-30");
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ date: "2026-09-30", status: "done" });
    expect(res.json().day).toMatchObject({ date: "2026-09-30", today: "2026-10-03" });
    // Untimed, so midday on that day (BST), not the moment it was sent.
    expect(res.json().day.entries).toEqual([expect.objectContaining({ date: "2026-09-30", logged_at: "2026-09-30T11:00:00.000Z" })]);
    const context = contextOf(ai!.requests[0]);
    expect(context).toMatchObject({ message_date: "2026-09-30", filling_in_past_day: true });
  });

  it("says nothing of a past day in an ordinary message's context", async () => {
    const { app, ai } = await appWith([textReply("Hi.")]);
    expect((await sendOn(app, "2026-10-03", "hello")).statusCode).toBe(201);
    expect(contextOf(ai!.requests[0])).not.toHaveProperty("filling_in_past_day");
  });

  it("refuses a day before the chat window and a day still to come", async () => {
    const { app } = await appWith([]);
    expect((await sendOn(app, "2026-09-29")).json()).toEqual({ error: "too_old" });
    expect((await sendOn(app, "2026-10-04")).json()).toEqual({ error: "future_date" });
  });
});
