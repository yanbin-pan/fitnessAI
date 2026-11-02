import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mergeSameRole, runCoachLoop } from "../src/coach/loop.ts";
import { buildSystemPrompt } from "../src/coach/prompt.ts";
import { listMemories, memoriesForCoach, saveMemory } from "../src/memories/memories.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { MAX_MEMORIES } from "../src/shared.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { NOW, logItemsInput, makeProfile, openTestDb, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const NOW_ISO = NOW.toISOString();
let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function appWith(steps: FakeStep[], profile = makeProfile()) {
  const ai = fakeAi(steps);
  ctx = await testApp({ ai });
  saveProfile(ctx.db, profile, NOW_ISO);
  return { app: ctx, ai };
}

function send(app: TestApp, text: string, sentAt = "2026-10-03T11:58:00.000Z") {
  return app.app.inject({ method: "POST", url: "/api/messages", headers: app.headers, payload: { id: randomUUID(), sent_at: sentAt, text } });
}

describe("memories in the store", () => {
  it("lists those still holding, newest first, and keeps at most MAX_MEMORIES", () => {
    const db = openTestDb();
    saveMemory(db.db, "00000001", { kind: "plan", text: "Rome trip", expires_on: "2026-10-01" }, "coach", "2026-09-20T10:00:00.000Z");
    saveMemory(db.db, "00000002", { kind: "preference", text: "Hates coriander" }, "person", "2026-09-21T10:00:00.000Z");
    saveMemory(db.db, "00000003", { kind: "plan", text: "Half marathon", expires_on: "2026-10-12" }, "coach", "2026-09-22T10:00:00.000Z");
    expect(listMemories(db.db, "2026-10-03").map((m) => m.text)).toEqual(["Half marathon", "Hates coriander"]);
    expect(memoriesForCoach(db.db, "2026-10-03")[0]).toEqual({ id: "00000003", kind: "plan", text: "Half marathon", until: "2026-10-12", saved: "2026-09-22" });
    for (let i = 0; i < MAX_MEMORIES + 5; i++) saveMemory(db.db, (100 + i).toString(16).padStart(8, "0"), { kind: "routine", text: `n${i}` }, "coach", new Date(Date.UTC(2026, 9, 3, 0, i)).toISOString());
    expect(listMemories(db.db, "2026-01-01")).toHaveLength(MAX_MEMORIES);
    db.close();
  });

  it("goes into the day's system prompt with its instructions, and not at all when switched off", () => {
    const prompt = buildSystemPrompt(makeProfile(), "2026-10-03", null, [{ id: "abcd0123", kind: "preference", text: "Hates coriander", saved: "2026-10-01" }]);
    expect(prompt).toContain("Save with remember, silently");
    expect(prompt).toContain("Follow up at the right moment");
    expect(prompt).toContain('What you remember about them (JSON):\n[{"id":"abcd0123","kind":"preference","text":"Hates coriander","saved":"2026-10-01"}]');
    expect(buildSystemPrompt(makeProfile(), "2026-10-03")).not.toContain("Memories:");
  });
});

describe("the coach's remember and forget", () => {
  it("saves silently in the same call as the reply: no second call to Claude", async () => {
    const { app, ai } = await appWith([
      toolCall([{ name: "remember", input: { kind: "plan", text: "Half marathon on 12 April", until: "2027-04-12", replaces: null } }], "Great, good luck with the training!"),
    ]);
    const res = await send(app, "I signed up for a half marathon on 12 April");
    expect(res.json().reply.text).toBe("Great, good luck with the training!");
    expect(ai.requests).toHaveLength(1);
    expect(listMemories(app.db, "2026-10-03")).toMatchObject([{ kind: "plan", text: "Half marathon on 12 April", expires_on: "2027-04-12", source: "coach" }]);

    // The next message replays the tool results; they join its turn, first, so the history stays valid.
    Object.assign(ai, fakeAi([textReply("Noted.")]));
    expect((await send(app, "thanks", "2026-10-03T12:05:00.000Z")).json().reply.text).toBe("Noted.");
    const sent = ai.requests[0].messages;
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect((sent[2].content as { type: string }[]).map((b) => b.type)[0]).toBe("tool_result");
  });

  it("updates with replaces and forgets, and asks Claude again when the reply has no words yet", async () => {
    const { app } = await appWith([
      toolCall([{ name: "forget", input: { id: "0badf00d" } }]),
      textReply("Done."),
    ]);
    saveMemory(app.db, "0badf00d", { kind: "training", text: "Sore left knee" }, "coach", NOW_ISO);
    saveMemory(app.db, "00c0ffee", { kind: "preference", text: "Likes tea" }, "coach", NOW_ISO);
    await send(app, "my knee is fine now");
    expect(listMemories(app.db, "2026-10-03").map((m) => m.id)).toEqual(["00c0ffee"]);
  });

  it("is refused while memories are off, and the tools are not offered", async () => {
    const { app, ai } = await appWith([textReply("Hi")], makeProfile({ memories: "off" }));
    await send(app, "hello");
    expect(ai.requests[0].tools.map((t) => t.name)).toEqual(["log_items", "update_entry"]);
    expect(ai.requests[0].system).not.toContain("Memories:");
  });

  it("keeps nothing when the message fails", async () => {
    const { app } = await appWith([
      toolCall([{ name: "remember", input: { kind: "preference", text: "Hates coriander", until: null, replaces: null } }, { name: "log_items", input: logItemsInput() }]),
    ]);
    await send(app, "no coriander please, had eggs");
    expect(listMemories(app.db, "2026-10-03")).toEqual([]);
  });
});

describe("mergeSameRole", () => {
  it("joins turns of the same role that follow each other", () => {
    const merged = mergeSameRole([
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] } as never,
      { role: "user", content: "c" },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[2].content).toEqual([{ type: "tool_result", tool_use_id: "t", content: "{}" }, { type: "text", text: "c" }]);
  });

  it("is what the loop sends", async () => {
    const ai = fakeAi([textReply("ok")]);
    await runCoachLoop({
      ai, system: "s", tools: [], maxCalls: 2, signal: new AbortController().signal, execute: () => ({ content: "{}", isError: false }),
      history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] } as never],
      userTurn: { role: "user", content: "c" },
    });
    expect(ai.requests[0].messages).toHaveLength(3);
  });
});

describe("/api/memories", () => {
  it("lists, adds, edits, deletes and forgets everything", async () => {
    const { app } = await appWith([]);
    const put = (id: string, payload: Record<string, unknown>) => app.app.inject({ method: "PUT", url: `/api/memories/${id}`, headers: app.headers, payload });
    expect((await put("1234abcd", { kind: "routine", text: " Gym Tue/Thu 7am " })).statusCode).toBe(201);
    expect((await put("1234abcd", { kind: "routine", text: "Gym Mon/Thu 7am" })).json()).toMatchObject({ id: "1234abcd", text: "Gym Mon/Thu 7am", source: "person" });
    expect((await put("not-an-id", { kind: "routine", text: "x" })).statusCode).toBe(404);
    expect((await put("1234abce", { kind: "routine", text: "" })).statusCode).toBe(400);
    await put("1234abce", { kind: "plan", text: "Japan", expires_on: "2026-11-20" });
    const list = await app.app.inject({ method: "GET", url: "/api/memories", headers: app.headers });
    expect(list.json().enabled).toBe(true);
    expect(list.json().memories.map((m: { id: string }) => m.id).sort()).toEqual(["1234abcd", "1234abce"]);
    expect((await app.app.inject({ method: "DELETE", url: "/api/memories/1234abce", headers: app.headers })).statusCode).toBe(204);
    expect(listMemories(app.db, "2026-10-03")).toHaveLength(1);
    await app.app.inject({ method: "DELETE", url: "/api/memories", headers: app.headers });
    expect(listMemories(app.db, "2026-10-03")).toEqual([]);
  });
});
