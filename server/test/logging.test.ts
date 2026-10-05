import { DrizzleQueryError } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { LOGGER, serializeError } from "../src/logging.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { NOW, TEST_CAPS, makeAccess, openTestDb, tempDir, testPeople } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
/** A person's key: the sha256 of their email, which is also the name of their folder. */
const KEY = "c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351";

describe("serializeError", () => {
  it("keeps a failed query's parameters out of the logs", () => {
    const db = openTestDb();
    const message = { id: "m1", date: "2026-10-03", text: "SECRET-MEAL", photoIds: [], sentAt: NOW_ISO, nowIso: NOW_ISO };
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

  describe("and a person's folder (2.2 §8)", () => {
    /** A real fs error: listing a person's photo folder that isn't there. */
    function missingPhotoFolder(): Error {
      try {
        fs.readdirSync(path.join(tempDir(), "users", KEY, "photos"));
      } catch (err) {
        return err as Error;
      }
      throw new Error("the folder was meant to be missing");
    }

    it("shows only the first 8 characters of the folder's name, in the message and the stack", () => {
      const failure = missingPhotoFolder();
      // fs puts the whole path in its message, and the stack starts with the message: this is what the serializer is for.
      expect(failure.message).toContain(`users/${KEY}/photos`);
      const logged = serializeError(failure);
      expect(logged.message).toContain("users/c8cd3c64…/photos");
      expect(logged.stack).toContain("users/c8cd3c64…/photos");
      expect(JSON.stringify(logged)).not.toContain(KEY);
    });

    it("does the same for a cause", () => {
      const logged = serializeError(new Error("could not list the photos", { cause: missingPhotoFolder() }));
      expect(logged.cause).toMatchObject({ type: "Error", message: expect.stringContaining("users/c8cd3c64…/photos") });
      expect(JSON.stringify(logged)).not.toContain(KEY);
    });

    it("does it whichever way the path is spelled, and leaves a photo's id alone", () => {
      const photo = "a".repeat(32);
      const windows = serializeError(new Error(`ENOENT: no such file or directory, open 'C:\\data\\users\\${KEY}\\photos\\${photo}.jpg'`));
      expect(windows.message).toBe(`ENOENT: no such file or directory, open 'C:\\data\\users\\c8cd3c64…\\photos\\${photo}.jpg'`);
      const posix = serializeError(new Error(`EACCES: permission denied, mkdir '/data/users/${KEY}.moving/db'`));
      expect(posix.message).toBe("EACCES: permission denied, mkdir '/data/users/c8cd3c64….moving/db'");
    });
  });
});

/** An app with its logger on, whose log lines land in `lines` instead of stdout. */
async function loggingApp() {
  const auth = await makeAccess();
  const { people } = testPeople();
  const lines: string[] = [];
  const app = buildApp({
    people, verifier: auth.verifier, now: () => NOW, webDist: null, ai: null, coachBudgetMs: 1, callCaps: TEST_CAPS,
    logger: true, logStream: { write: (line: string) => void lines.push(line) },
  });
  await app.ready();
  return { app, auth, lines, close: async () => { await app.close(); people.close(); } };
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

  it("says an intruder is not on the list without logging any email address", async () => {
    const ctx = await loggingApp();
    try {
      const token = await ctx.auth.token({ email: "intruder@example.com" });
      const res = await ctx.app.inject({ method: "GET", url: "/api/profile", headers: { "cf-access-jwt-assertion": token } });
      expect(res.statusCode).toBe(401);
      const refused = ctx.lines.filter((line) => line.includes("access token refused"));
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain('"detail":"not on the list"');
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
    const { people } = testPeople();
    const app = buildApp({ people, verifier: auth.verifier, now: () => NOW, webDist: null, ai: null, coachBudgetMs: 1, callCaps: TEST_CAPS, logger: true });
    try {
      // pino keeps a logger's serializers under this symbol; Fastify itself reads it the same way.
      const serializers = (app.log as unknown as Record<symbol, Record<string, unknown>>)[Symbol.for("pino.serializers")];
      expect(serializers.err).toBe(serializeError);
    } finally {
      await app.close();
      people.close();
    }
  });
});
