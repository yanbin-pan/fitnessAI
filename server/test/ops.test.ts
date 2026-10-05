import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { preparePersonDir } from "../src/db/location.ts";
import { runNightlySnapshot, startNightlySnapshot } from "../src/jobs.ts";
import { createMetrics, recordCoach, serveMetrics } from "../src/metrics.ts";
import { shortKey } from "../src/people/people.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { NOW, makeProfile, openTestDb, tempDir, testApp, testPeople, unlistable } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe("metrics", () => {
  it("count coach outcomes, model calls and tokens", async () => {
    const metrics = createMetrics();
    recordCoach(metrics, { outcome: "done", calls: 2, usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 } });
    recordCoach(metrics, null);
    const text = await metrics.registry.metrics();
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done"} 1');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="internal"} 1');
    expect(text).toContain("fitnessai_coach_model_calls_total 2");
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens"} 200');
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
