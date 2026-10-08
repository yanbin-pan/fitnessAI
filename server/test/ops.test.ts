import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { preparePersonDir } from "../src/db/location.ts";
import { runNightlySnapshot, startNightlySnapshot } from "../src/jobs.ts";
import { createMetrics, personLabels, recordCoach, seedPeople, serveMetrics } from "../src/metrics.ts";
import type { Metrics } from "../src/metrics.ts";
import { personKey, shortKey } from "../src/people/people.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { fakeAi, textReply } from "./fake-ai.ts";
import { NOW, makeProfile, openTestDb, tempDir, testApp, testPeople, unlistable } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const FRIEND = "friend@example.com";
// How metrics, like logs, name a person: the first 8 hex characters of sha256(email) (2.2 §8), and owner or guest.
const OWNER = { person: "c8cd3c64", role: "owner" } as const; // owner@example.com
const GUEST = { person: "f387373a", role: "guest" } as const; // friend@example.com
/** The same two people as startup knows them: their keys, and whether they own the app. */
const PEOPLE = [{ key: personKey("owner@example.com"), owner: true }, { key: personKey(FRIEND), owner: false }];
/** Every outcome a coach message can end with, written out here independently of the source. */
const OUTCOMES = ["done", "ai_cap", "ai_unavailable", "no_profile", "timeout", "ai_error", "ai_rate_limited", "refused", "max_tokens", "tool_loop_limit", "internal"];

/** One metric's series as exposed (`name{labels} value`), sorted so the order they arrived in doesn't matter. */
const seriesOf = (text: string, name: string) => text.split("\n").filter((line) => line.startsWith(`${name}{`)).sort();

/** The owner and a guest, each with a profile and a coach that answers: two messages from the owner, one from the guest (streamed, as the phone sends it). */
async function twoPeopleAtWork(metrics: Metrics): Promise<TestApp> {
  const t = await testApp({ guests: [FRIEND], ai: fakeAi([textReply("Morning."), textReply("Noted."), textReply("Hello.")]), metrics });
  ctx = t;
  saveProfile(t.db, makeProfile(), NOW.toISOString());
  saveProfile(t.storeOf(FRIEND).db, makeProfile(), NOW.toISOString());
  const guest = await t.headersFor(FRIEND);
  const message = (headers: Record<string, string>) =>
    t.app.inject({ method: "POST", url: "/api/messages", headers, payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", text: "two eggs" } });
  const sent = [await message(t.headers), await message(t.headers), await message({ ...guest, accept: "text/event-stream" })];
  expect(sent.map((res) => res.statusCode)).toEqual([201, 201, 200]);
  return t;
}

describe("metrics", () => {
  it("count coach outcomes, model calls and tokens under each person's short id and role", async () => {
    const metrics = createMetrics();
    recordCoach(metrics, { outcome: "done", calls: 2, usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 } }, OWNER);
    recordCoach(metrics, null, OWNER);
    // A refusal never reached Claude: a message with no tokens, and its zero calls add nothing.
    recordCoach(metrics, { outcome: "ai_cap", calls: 0, usage: null }, GUEST);
    recordCoach(metrics, { outcome: "done", calls: 1, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, GUEST);
    const text = await metrics.registry.metrics();
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="c8cd3c64",role="owner"} 1');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="internal",person="c8cd3c64",role="owner"} 1');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="ai_cap",person="f387373a",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="f387373a",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_model_calls_total{person="c8cd3c64",role="owner"} 2');
    expect(text).toContain('fitnessai_coach_model_calls_total{person="f387373a",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens",person="c8cd3c64",role="owner"} 200');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="cache_creation_input_tokens",person="c8cd3c64",role="owner"} 10');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="output_tokens",person="f387373a",role="guest"} 20');
    // Every count is somebody's: no series without a person.
    expect(text).not.toMatch(/^fitnessai_coach_\w+ \d/m);
  });

  it("name a person by the first 8 characters of their key and by their role, and by nothing else", () => {
    expect(personLabels({ key: personKey("owner@example.com"), owner: true })).toEqual(OWNER);
    // The signed-in person a route holds has more in it (their database, their photo folder): none of that comes out.
    const person = { key: personKey(FRIEND), owner: false, photoDir: "/data/users/somebody/photos" };
    expect(personLabels(person)).toEqual(GUEST);
  });

  it("label each person's coach messages, model calls and tokens through the message route, streamed or not", async () => {
    const metrics = createMetrics();
    await twoPeopleAtWork(metrics);
    const text = await metrics.registry.metrics();
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="c8cd3c64",role="owner"} 2');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="f387373a",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_model_calls_total{person="c8cd3c64",role="owner"} 2');
    expect(text).toContain('fitnessai_coach_model_calls_total{person="f387373a",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens",person="c8cd3c64",role="owner"} 200');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens",person="f387373a",role="guest"} 100');
    expect(text).not.toMatch(/^fitnessai_coach_\w+ \d/m);
  });

  it("count HTTP requests by route", async () => {
    const metrics = createMetrics();
    ctx = await testApp({ metrics });
    await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(await metrics.registry.metrics()).toContain('fitnessai_http_requests_total{method="GET",route="/api/health",status="200"} 1');
  });

  it("time HTTP requests by route", async () => {
    const metrics = createMetrics();
    ctx = await testApp({ metrics });
    await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(await metrics.registry.metrics()).toContain('fitnessai_http_request_duration_seconds_count{method="GET",route="/api/health"} 1');
  });

  it("label requests by route pattern, so unknown URLs cannot multiply the series", async () => {
    const metrics = createMetrics();
    ctx = await testApp({ metrics });
    for (const day of ["2026-10-01", "2026-10-02"]) await ctx.app.inject({ method: "GET", url: `/api/days/${day}`, headers: ctx.headers });
    await ctx.app.inject({ method: "GET", url: "/no/such/path" });
    const series = (await metrics.registry.metrics()).split("\n").filter((l) => l.startsWith("fitnessai_http_requests_total{"));
    expect(series).toHaveLength(2);
    expect(series.join("\n")).toContain('route="/api/days/:date"');
    expect(series.join("\n")).toContain('route="unmatched"');
  });

  it("count a signed-in request under the person's short id and role, and no other request", async () => {
    const metrics = createMetrics();
    const t = await testApp({ guests: [FRIEND], metrics });
    ctx = t;
    const guest = await t.headersFor(FRIEND);
    const get = (url: string, headers?: Record<string, string>) => t.app.inject({ method: "GET", url, headers });
    // Signed in: the owner twice (a lookup that finds nothing is still their request), the guest once.
    await get("/api/profile", t.headers);
    await get("/api/days/2026-10-01", t.headers);
    await get("/api/days/2026-10-01", guest);
    // Nobody signed in: the health probe, no token, a token for someone off the list, and a path outside the API.
    await get("/api/health");
    await get("/api/profile");
    await get("/api/profile", await t.headersFor("stranger@example.com"));
    await get("/no/such/path");
    const text = await metrics.registry.metrics();
    expect(seriesOf(text, "fitnessai_requests_by_person_total")).toEqual([
      'fitnessai_requests_by_person_total{person="c8cd3c64",role="owner"} 2',
      'fitnessai_requests_by_person_total{person="f387373a",role="guest"} 1',
    ]);
    // The route, status and duration metrics stay as they were: nothing about a person, so they don't grow with the guest list.
    const http = text.split("\n").filter((line) => line.startsWith("fitnessai_http_"));
    expect(http.length).toBeGreaterThan(0);
    expect(http.filter((line) => /person|role/.test(line))).toEqual([]);
  });

  it("never count a static file or the health probe, even with the person's token on it", async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><div id="root"></div>');
    const metrics = createMetrics();
    const t = await testApp({ webDist: dist, metrics });
    ctx = t;
    // Cloudflare Access puts the token on every request it forwards, the PWA's own files included.
    for (const url of ["/", "/index.html", "/day/today", "/api/health"]) {
      expect((await t.app.inject({ method: "GET", url, headers: t.headers })).statusCode).toBe(200);
    }
    await t.app.inject({ method: "GET", url: "/api/days/2026-10-01", headers: t.headers }); // the one that counts
    expect(seriesOf(await metrics.registry.metrics(), "fitnessai_requests_by_person_total")).toEqual([
      'fitnessai_requests_by_person_total{person="c8cd3c64",role="owner"} 1',
    ]);
  });

  // The owner's choice (2026-10-08): the dashboard shows who is who, so everyone on the invite list is named by email.
  it("name everyone on the invite list by email, through the routes and the seed alike", async () => {
    const metrics = createMetrics(new Map([[personKey("owner@example.com"), "owner@example.com"], [personKey(FRIEND), FRIEND]]));
    seedPeople(metrics, PEOPLE);
    await twoPeopleAtWork(metrics);
    const text = await metrics.registry.metrics();
    expect(seriesOf(text, "fitnessai_requests_by_person_total")).toEqual([
      'fitnessai_requests_by_person_total{person="friend@example.com",role="guest"} 1',
      'fitnessai_requests_by_person_total{person="owner@example.com",role="owner"} 2',
    ]);
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="owner@example.com",role="owner"} 2');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="friend@example.com",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens",person="friend@example.com",role="guest"} 100');
    // One series each: the seed and the traffic name a person the same way, so no short id sits beside an email.
    expect(seriesOf(text, "fitnessai_coach_model_calls_total")).toEqual([
      'fitnessai_coach_model_calls_total{person="friend@example.com",role="guest"} 1',
      'fitnessai_coach_model_calls_total{person="owner@example.com",role="owner"} 2',
    ]);
    expect(text).not.toMatch(/person="[0-9a-f]{8}"/);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("name someone taken off the list by short id, never by their whole key", () => {
    const names = new Map([[personKey("owner@example.com"), "owner@example.com"]]);
    expect(personLabels({ key: personKey("owner@example.com"), owner: true }, names)).toEqual({ person: "owner@example.com", role: "owner" });
    expect(personLabels({ key: personKey(FRIEND), owner: false }, names)).toEqual(GUEST);
  });

  it("count a Retry under the person who sent the message", async () => {
    const metrics = createMetrics();
    const t = await testApp({ guests: [FRIEND], ai: fakeAi([new AiError("api_error", "down"), textReply("Noted.")]), metrics });
    ctx = t;
    saveProfile(t.storeOf(FRIEND).db, makeProfile(), NOW.toISOString());
    const guest = await t.headersFor(FRIEND);
    const sent = await t.app.inject({ method: "POST", url: "/api/messages", headers: guest, payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", text: "two eggs" } });
    expect(sent.json().user.status).toBe("failed");
    const retried = await t.app.inject({ method: "POST", url: `/api/messages/${sent.json().user.id}/retry`, headers: guest });
    expect(retried.json().user.status).toBe("done");
    const text = await metrics.registry.metrics();
    expect(text).toContain('fitnessai_coach_messages_total{outcome="ai_error",person="f387373a",role="guest"} 1');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done",person="f387373a",role="guest"} 1');
  });

  it("never carry an email or a whole key, whatever the people do", async () => {
    const metrics = createMetrics();
    const t = await twoPeopleAtWork(metrics);
    await t.app.inject({ method: "GET", url: "/api/profile", headers: await t.headersFor("stranger@example.com") });
    const text = await metrics.registry.metrics();
    // The people are in there, so the checks below are not passing on an empty page.
    expect(text).toContain('person="c8cd3c64"');
    expect(text).toContain('person="f387373a"');
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    for (const email of ["owner@example.com", FRIEND, "stranger@example.com"]) expect(text).not.toContain(personKey(email));
  });

  // Prometheus sees growth only between two scrapes, so a series that is born at 1 after a restart looks like no growth at all.
  it("start each person's series at zero, so their first request or message after a restart still counts as growth", async () => {
    const metrics = createMetrics();
    seedPeople(metrics, PEOPLE);
    const text = await metrics.registry.metrics();
    /** What seeding leaves of one metric: a zero for each person, sorted like `seriesOf`. */
    const zeros = (name: string, before = "") => [OWNER, GUEST].map((who) => `${name}{${before}person="${who.person}",role="${who.role}"} 0`).sort();
    expect(seriesOf(text, "fitnessai_requests_by_person_total")).toEqual(zeros("fitnessai_requests_by_person_total"));
    expect(seriesOf(text, "fitnessai_coach_model_calls_total")).toEqual(zeros("fitnessai_coach_model_calls_total"));
    // Every outcome is seeded, so a first refusal or failure after a restart still shows as growth.
    expect(seriesOf(text, "fitnessai_coach_messages_total")).toEqual(
      OUTCOMES.flatMap((outcome) => zeros("fitnessai_coach_messages_total", `outcome="${outcome}",`)).sort(),
    );
    const kinds = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
    expect(seriesOf(text, "fitnessai_coach_tokens_total")).toEqual(kinds.flatMap((kind) => zeros("fitnessai_coach_tokens_total", `kind="${kind}",`)).sort());
    // Seeded from keys, and still only short ids come out.
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("count a person's activity on the series seeded for them, not beside them", async () => {
    const metrics = createMetrics();
    seedPeople(metrics, PEOPLE);
    await twoPeopleAtWork(metrics);
    const text = await metrics.registry.metrics();
    // Still one series each: were the seed and the traffic to label a person differently, there would be four.
    expect(seriesOf(text, "fitnessai_requests_by_person_total")).toEqual([
      'fitnessai_requests_by_person_total{person="c8cd3c64",role="owner"} 2',
      'fitnessai_requests_by_person_total{person="f387373a",role="guest"} 1',
    ]);
    const messages = seriesOf(text, "fitnessai_coach_messages_total");
    expect(messages).toHaveLength(OUTCOMES.length * 2);
    expect(messages).toContain('fitnessai_coach_messages_total{outcome="done",person="c8cd3c64",role="owner"} 2');
    expect(messages).toContain('fitnessai_coach_messages_total{outcome="done",person="f387373a",role="guest"} 1');
    expect(messages.filter((line) => !line.includes('outcome="done"')).every((line) => line.endsWith(" 0"))).toBe(true);
    expect(seriesOf(text, "fitnessai_coach_model_calls_total")).toEqual([
      'fitnessai_coach_model_calls_total{person="c8cd3c64",role="owner"} 2',
      'fitnessai_coach_model_calls_total{person="f387373a",role="guest"} 1',
    ]);
    expect(seriesOf(text, "fitnessai_coach_tokens_total")).toHaveLength(8);
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens",person="c8cd3c64",role="owner"} 200');
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens",person="f387373a",role="guest"} 100');
  });

  it("are served on their own port, and nothing else is", async () => {
    const server = await serveMetrics(createMetrics(), 0);
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("process_cpu_user_seconds_total");
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(404);
    server.close();
  });

  it("can be bound to one address, so a development server stays off the network", async () => {
    const server = await serveMetrics(createMetrics(), 0, "127.0.0.1");
    try {
      expect(server.address()).toMatchObject({ address: "127.0.0.1" });
    } finally {
      server.close();
    }
  });

  it("listen on every interface unless told otherwise, so the cluster can scrape the pod", async () => {
    const server = await serveMetrics(createMetrics(), 0);
    try {
      expect(server.address()).toMatchObject({ address: "0.0.0.0" });
    } finally {
      server.close();
    }
  });
});

describe("runNightlySnapshot", () => {
  it("names each snapshot after the local date and keeps the newest", () => {
    const db = openTestDb();
    const dir = tempDir();
    for (const iso of ["2026-10-01T02:00:00Z", "2026-10-02T02:00:00Z", "2026-10-03T02:00:00Z"]) {
      runNightlySnapshot(db.sqlite, dir, 2, "Europe/London", new Date(iso));
    }
    expect(fs.readdirSync(dir).sort()).toEqual(["fitness-2026-10-02.db", "fitness-2026-10-03.db"]);
    db.close();
  });

  it("never prunes the pre-migration snapshots that share its directory", () => {
    const db = openTestDb();
    const dir = tempDir();
    const startup = ["startup-2026-09-30T01-00-00-000Z.db", "startup-2026-10-01T01-00-00-000Z.db", "startup-2026-10-02T01-00-00-000Z.db"];
    for (const name of startup) fs.writeFileSync(path.join(dir, name), "");
    for (const iso of ["2026-10-01T02:00:00Z", "2026-10-02T02:00:00Z", "2026-10-03T02:00:00Z"]) {
      runNightlySnapshot(db.sqlite, dir, 1, "Europe/London", new Date(iso));
    }
    expect(fs.readdirSync(dir).sort()).toEqual(["fitness-2026-10-03.db", ...startup]);
    db.close();
  });
});

/** A logger that only remembers what it was asked to say. `refuseNextError` makes its next error line throw, as a broken log pipe might. */
function recorder() {
  const calls: { level: "info" | "error"; fields: Record<string, unknown>; msg: string }[] = [];
  let refusal: Error | null = null;
  const log = {
    info: (fields: Record<string, unknown>, msg: string) => calls.push({ level: "info", fields, msg }),
    error: (fields: Record<string, unknown>, msg: string) => {
      if (refusal) {
        const err = refusal;
        refusal = null;
        throw err;
      }
      calls.push({ level: "error", fields, msg });
    },
  } as unknown as FastifyBaseLogger;
  return {
    log,
    calls,
    refuseNextError(err: Error) {
      refusal = err;
    },
  };
}

describe("startNightlySnapshot", () => {
  it("is set for 03:00 in the owner's timezone, whatever the pod's", () => {
    const { people } = testPeople();
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log: recorder().log });
    const tokyo = startNightlySnapshot({ people, keep: 7, timeZone: "Asia/Tokyo", log: recorder().log });
    try {
      // 13:00 BST on 3 October: the next 03:00 in London is 03:00 BST, which is 02:00 UTC.
      expect(job.nextRun(new Date("2026-10-03T12:00:00Z"))?.toISOString()).toBe("2026-10-04T02:00:00.000Z");
      // After the clocks go back on 25 October, 03:00 in London is 03:00 UTC.
      expect(job.nextRun(new Date("2026-10-25T12:00:00Z"))?.toISOString()).toBe("2026-10-26T03:00:00.000Z");
      // No host zone can also give Tokyo (UTC+9, no daylight saving): 18:00 UTC the evening before.
      expect(tokyo.nextRun(new Date("2026-10-03T12:00:00Z"))?.toISOString()).toBe("2026-10-03T18:00:00.000Z");
    } finally {
      job.stop();
      tokyo.stop();
      people.close();
    }
  });

  it("writes everyone's snapshot when it fires, each named after its person's own date, and logs no email", async () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    saveProfile(stores[1].db, makeProfile({ timezone: "Pacific/Kiritimati" }), NOW.toISOString());
    const { log, calls } = recorder();
    // 12:00 UTC on 3 October is the 3rd in London (the default with no profile) and already the 4th on Kiritimati (UTC+14).
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    try {
      await job.trigger();
      expect(fs.readdirSync(stores[0].snapshotDir)).toEqual(["fitness-2026-10-03.db"]);
      expect(fs.readdirSync(stores[1].snapshotDir)).toEqual(["fitness-2026-10-04.db"]);
      expect(calls.map((c) => c.level)).toEqual(["info", "info"]);
      expect(calls.map((c) => c.fields.person).sort()).toEqual(stores.map((s) => shortKey(s.key)).sort());
      expect(calls.map((c) => c.fields.file).sort()).toEqual(["fitness-2026-10-03.db", "fitness-2026-10-04.db"]);
      const text = JSON.stringify(calls);
      expect(text).not.toContain("@");
      for (const store of stores) expect(text).not.toContain(store.key);
    } finally {
      job.stop();
      people.close();
    }
  });

  it("logs one person's failed snapshot and still writes everyone else's", async () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    const { log, calls } = recorder();
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    stores[0].sqlite.close(); // this person's snapshot now fails: the connection is closed
    try {
      await expect(job.trigger()).resolves.toBeUndefined();
      const errors = calls.filter((c) => c.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].msg).toBe("nightly snapshot failed");
      // Exactly the error and the start of the key: no email, no whole key, nothing else.
      expect(errors[0].fields).toEqual({ err: expect.any(Error), person: shortKey(stores[0].key) });
      expect(fs.readdirSync(stores[1].snapshotDir)).toHaveLength(1);
    } finally {
      job.stop();
      people.close();
    }
  });

  it("logs a person whose database will not open, and still writes the next person's snapshot", async () => {
    const { dataDir, people, stores } = testPeople("owner@example.com");
    // A folder nobody has opened in this process, whose database is garbage. Its key sorts first, so the owner's comes after it.
    const broken = "0".repeat(64);
    fs.writeFileSync(preparePersonDir(dataDir, broken).dbFile, "this is not a database. ".repeat(20));
    const { log, calls } = recorder();
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    try {
      expect(people.keys()).toEqual([broken, stores[0].key]);
      await expect(job.trigger()).resolves.toBeUndefined();
      expect(calls.filter((c) => c.level === "error")).toEqual([
        { level: "error", msg: "nightly snapshot failed", fields: { err: expect.objectContaining({ code: "SQLITE_NOTADB" }), person: shortKey(broken) } },
      ]);
      expect(calls.filter((c) => c.level === "info").map((c) => c.fields.person)).toEqual([shortKey(stores[0].key)]);
      expect(fs.readdirSync(stores[0].snapshotDir)).toEqual(["fitness-2026-10-03.db"]);
    } finally {
      job.stop();
      people.close();
    }
  });

  it("logs a failure to list the folders once and does not reject, because croner runs the job un-awaited and Node exits on an unhandled rejection", async () => {
    const { people } = testPeople("owner@example.com");
    const { log, calls } = recorder();
    const job = startNightlySnapshot({ people: unlistable(people), keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    try {
      await expect(job.trigger()).resolves.toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ level: "error", msg: "nightly snapshot failed" });
      // The listing itself failed, not anyone's folder: no person to name.
      expect(Object.keys(calls[0].fields)).toEqual(["err"]);
      expect(calls[0].fields.err).toBeInstanceOf(Error);
    } finally {
      job.stop();
      people.close();
    }
  });

  it("logs whatever else escapes a run through croner's own catch, so the run can never reject", async () => {
    const { people } = testPeople("owner@example.com");
    const { log, calls, refuseNextError } = recorder();
    const job = startNightlySnapshot({ people: unlistable(people), keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    // The listing fails, and then the logger fails on the line about it: the one throw the job's own guard cannot catch.
    refuseNextError(new Error("the log pipe is closed"));
    try {
      await expect(job.trigger()).resolves.toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ level: "error", msg: "nightly snapshot failed" });
      expect(calls[0].fields.err).toMatchObject({ message: "the log pipe is closed" });
    } finally {
      job.stop();
      people.close();
    }
  });
});
