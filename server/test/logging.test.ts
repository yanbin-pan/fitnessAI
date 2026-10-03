import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LOGGER, serializeError } from "../src/logging.ts";
import { insertUserMessage } from "../src/messages/messages.ts";
import { openTestDb } from "./helpers.ts";

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
