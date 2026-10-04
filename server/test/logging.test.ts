import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { LOGGER, serializeError } from "../src/logging.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { NOW, makeAccess, openTestDb } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";

describe("serializeError", () => {
  it("keeps a failed query's parameters out of the logs", () => {
    const db = openTestDb();
    const message = { id: "m1", date: "2026-10-03", text: "SECRET-MEAL", sentAt: NOW_ISO, nowIso: NOW_ISO };
    insertUserMessage(db.db, message);
    let failure: unknown;
    try {
      insertUserMessage(db.db, message);
    } catch (err) {
      failure = err;
    }
    db.close();
    expect(failure).toBeInstanceOf(Error);
    // better-sqlite3's own failure carries no values, so it logs as it is.
    expect(JSON.stringify(serializeError(failure))).not.toContain("SECRET-MEAL");
    // Drizzle's async SQLite drivers wrap a failure with the query's text and parameters. Its sync
    // better-sqlite3 driver does not (drizzle-orm 0.45.3), so build the wrapper here to pin the
    // serializer against the day a driver or a Drizzle upgrade starts wrapping.
    const caught = new DrizzleQueryError("insert into messages (id, text) values (?, ?)", [message.id, message.text], failure as Error);
    expect(caught).toBeInstanceOf(Error);
    // The raw error does carry the text, which is why the serializer exists.
    expect(caught.message).toContain("SECRET-MEAL");
    const logged = JSON.stringify(serializeError(caught));
    expect(logged).not.toContain("SECRET-MEAL");
    expect(logged).toContain("SQLITE_CONSTRAINT");
  });

  it("keeps ordinary errors readable", () => {
    expect(serializeError(new TypeError("bad thing"))).toMatchObject({ type: "TypeError", message: "bad thing" });
  });

  it("is the logger's error serializer", () => {
    expect(LOGGER.serializers.err).toBe(serializeError);
  });
});

/** An app with its logger on, whose log lines land in `lines` instead of stdout. */
async function loggingApp() {
  const auth = await makeAccess();
  const database = openTestDb();
  const lines: string[] = [];
  const app = buildApp({
    db: database.db, verifier: auth.verifier, now: () => NOW, webDist: null, ai: null, coachBudgetMs: 1,
    logger: true, logStream: { write: (line: string) => void lines.push(line) },
  });
  await app.ready();
  return { app, auth, lines, close: async () => { await app.close(); database.close(); } };
}

describe("a refused Access token", () => {
  it("logs why it was refused, and never the token", async () => {
    const ctx = await loggingApp();
    try {
      const token = await ctx.auth.token({ aud: "other-aud" });
      const res = await ctx.app.inject({ method: "GET", url: "/api/profile", headers: { "cf-access-jwt-assertion": token } });
      expect(res.statusCode).toBe(401);
      const refused = ctx.lines.filter((line) => line.includes("access token refused"));
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain("ERR_JWT_CLAIM_VALIDATION_FAILED");
      expect(refused[0]).toContain('"claim":"aud"');
      expect(ctx.lines.filter((line) => line.includes(token))).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it("stays quiet when no token was sent", async () => {
    const ctx = await loggingApp();
    try {
      const res = await ctx.app.inject({ method: "GET", url: "/api/profile" });
      expect(res.statusCode).toBe(401);
      expect(ctx.lines.length).toBeGreaterThan(0); // the request itself was logged, so the capture works
      expect(ctx.lines.filter((line) => line.includes("access token refused"))).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it("says an intruder is not the owner without logging any email address", async () => {
    const ctx = await loggingApp();
    try {
      const token = await ctx.auth.token({ email: "intruder@example.com" });
      const res = await ctx.app.inject({ method: "GET", url: "/api/profile", headers: { "cf-access-jwt-assertion": token } });
      expect(res.statusCode).toBe(401);
      const refused = ctx.lines.filter((line) => line.includes("access token refused"));
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain('"detail":"not the owner"');
      const all = ctx.lines.join("\n");
      expect(all).not.toContain("intruder@example.com");
      expect(all).not.toContain("owner@example.com");
    } finally {
      await ctx.close();
    }
  });
});

describe("buildApp logging", () => {
  it("logs errors through the scrubbing serializer", async () => {
    const auth = await makeAccess();
    const database = openTestDb();
    const app = buildApp({ db: database.db, verifier: auth.verifier, now: () => NOW, webDist: null, ai: null, coachBudgetMs: 1, logger: true });
    try {
      // pino keeps a logger's serializers under this symbol; Fastify itself reads it the same way.
      const serializers = (app.log as unknown as Record<symbol, Record<string, unknown>>)[Symbol.for("pino.serializers")];
      expect(serializers.err).toBe(serializeError);
    } finally {
      await app.close();
      database.close();
    }
  });
});
