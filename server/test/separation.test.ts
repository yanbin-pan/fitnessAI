import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { entries, photos } from "../src/db/schema.ts";
import { personKey } from "../src/people/people.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import { fakeJpeg } from "./images.ts";
import { logItemsInput, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};
const BANANA = { name: "Banana", kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 };
const FRIEND = "friend@example.com";
type Headers = Record<string, string>;

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** The owner and one guest, each with their own profile. The coach logs eggs for each of the first two messages. */
async function twoPeople(): Promise<{ app: TestApp; owner: Headers; guest: Headers }> {
  const eggs = () => [toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")];
  const app = await testApp({ guests: [FRIEND], ai: fakeAi([...eggs(), ...eggs()]) });
  t = app;
  const owner = app.headers;
  const guest = await app.headersFor(FRIEND);
  expect((await app.app.inject({ method: "PUT", url: "/api/profile", headers: owner, payload: PROFILE })).statusCode).toBe(200);
  expect((await app.app.inject({ method: "PUT", url: "/api/profile", headers: guest, payload: { ...PROFILE, weight_kg: 60 } })).statusCode).toBe(200);
  return { app, owner, guest };
}

/** The photo files in a folder, by what is really on disk. */
const images = (dir: string) => fs.readdirSync(dir).filter((f) => /\.(jpg|png)$/.test(f));
const get = (app: TestApp, url: string, headers: Headers) => app.app.inject({ method: "GET", url, headers });
const addBanana = (app: TestApp, headers: Headers, id = randomUUID()) =>
  app.app.inject({ method: "POST", url: "/api/entries", headers, payload: { id, date: "2026-10-03", foods: [BANANA] } });
const send = (app: TestApp, headers: Headers, body: { text: string; photo_ids?: string[] }) =>
  app.app.inject({ method: "POST", url: "/api/messages", headers, payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", ...body } });

describe("friends and family (2.2)", () => {
  it("lets a listed guest in, whatever the case of their email, and answers anyone else as if unsigned", async () => {
    const app = await testApp({ guests: [FRIEND] });
    t = app;
    expect((await get(app, "/api/profile", await app.headersFor("Friend@Example.com"))).statusCode).toBe(404); // in, with no profile yet
    const stranger = await get(app, "/api/profile", await app.headersFor("stranger@example.com"));
    const unsigned = await app.app.inject({ method: "GET", url: "/api/profile" });
    expect([stranger.statusCode, stranger.body]).toEqual([401, ""]);
    expect([unsigned.statusCode, unsigned.body]).toEqual([401, ""]);
    // The stranger made nothing: no folder of their own, only the owner's and the guest's.
    const folders = fs.readdirSync(path.join(app.dataDir, "users")).sort();
    expect(folders).toEqual([personKey("owner@example.com"), personKey(FRIEND)].sort());
  });

  it("gives each person their own profile", async () => {
    const { app, owner, guest } = await twoPeople();
    expect((await get(app, "/api/profile", owner)).json().profile.weight_kg).toBe(80);
    expect((await get(app, "/api/profile", guest)).json().profile.weight_kg).toBe(60);
  });

  it("never shows one person's days, entries or calendar to the other", async () => {
    const { app, owner, guest } = await twoPeople();
    const id = randomUUID();
    expect((await addBanana(app, owner, id)).statusCode).toBe(201);
    expect((await get(app, "/api/days/2026-10-03", guest)).json().entries).toEqual([]);
    expect((await get(app, "/api/days?from=2026-10-01&to=2026-10-03", guest)).json().days).toEqual([]);
    expect((await get(app, "/api/days?from=2026-10-01&to=2026-10-03", owner)).json().days).toHaveLength(1);
    // Someone else's entry id is simply not there.
    const patch = await app.app.inject({ method: "PATCH", url: `/api/entries/${id}`, headers: guest, payload: { foods: [BANANA], exercises: [] } });
    expect(patch.statusCode).toBe(404);
    expect((await app.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: guest })).statusCode).toBe(404);
    expect((await get(app, "/api/days/2026-10-03", owner)).json().entries.map((e: { id: string }) => e.id)).toEqual([id]);
  });

  it("keeps each person's conversation with the coach, and what it logged, to that person", async () => {
    const { app, owner, guest } = await twoPeople();
    expect((await send(app, owner, { text: "two scrambled eggs" })).statusCode).toBe(201);
    expect((await send(app, guest, { text: "eggs for me too" })).statusCode).toBe(201);
    const ownersDay = (await get(app, "/api/days/2026-10-03", owner)).json();
    const guestsDay = (await get(app, "/api/days/2026-10-03", guest)).json();
    expect(ownersDay.messages.map((m: { text: string }) => m.text)).toEqual(["two scrambled eggs", "Logged."]);
    expect(guestsDay.messages.map((m: { text: string }) => m.text)).toEqual(["eggs for me too", "Logged."]);
    expect(ownersDay.entries).toHaveLength(1);
    expect(guestsDay.entries).toHaveLength(1);
    // Retrying someone else's message by its id finds nothing.
    const retry = await app.app.inject({ method: "POST", url: `/api/messages/${ownersDay.messages[0].id}/retry`, headers: guest });
    expect(retry.statusCode).toBe(404);
  });

  it("serves a photo only to the person who uploaded it", async () => {
    const { app, owner, guest } = await twoPeople();
    const upload = await app.app.inject({ method: "POST", url: "/api/photos", headers: { ...owner, "content-type": "image/jpeg" }, payload: fakeJpeg(8, 6) });
    expect(upload.statusCode).toBe(201);
    const { id } = upload.json();
    expect((await get(app, `/api/photos/${id}`, owner)).statusCode).toBe(200);
    expect((await get(app, `/api/photos/${id}`, guest)).statusCode).toBe(404);
    // Nor can the guest attach it to a message of their own.
    const claim = await send(app, guest, { text: "", photo_ids: [id] });
    expect(claim.statusCode).toBe(400);
    expect(claim.json()).toEqual({ error: "photo_not_found" });
  });

  it("keeps each person's rows in their own database and photos in their own folder", async () => {
    const { app, owner, guest } = await twoPeople();
    const id = randomUUID();
    await addBanana(app, owner, id);
    await app.app.inject({ method: "POST", url: "/api/photos", headers: { ...guest, "content-type": "image/jpeg" }, payload: fakeJpeg(8, 6) });
    const theirs = app.storeOf(FRIEND);
    expect(app.db.select({ id: entries.id }).from(entries).all()).toEqual([{ id }]);
    expect(theirs.db.select().from(entries).all()).toEqual([]);
    expect(app.db.select().from(photos).all()).toEqual([]);
    expect(theirs.db.select().from(photos).all()).toHaveLength(1);
    // The files themselves, not the paths: the guest's photo is in the guest's folder and nowhere in the owner's.
    expect(images(theirs.photoDir)).toHaveLength(1);
    expect(images(app.photoDir)).toEqual([]);
  });

  it("fails one person's first request when their folder can't be made, and serves everyone else as before, with no address or whole key in the log", async () => {
    const lines: string[] = [];
    const app = await testApp({ guests: [FRIEND, "mum@example.com"], logLines: lines });
    t = app;
    // A file where the friend's folder should be, as a broken volume might leave: it can't be opened or made.
    const users = path.join(app.dataDir, "users");
    fs.mkdirSync(users, { recursive: true });
    fs.writeFileSync(path.join(users, personKey(FRIEND)), "a file, not a folder");
    const broken = await get(app, "/api/profile", await app.headersFor(FRIEND));
    expect(broken.statusCode).toBe(500);
    expect(broken.json()).toEqual({ error: "internal" });
    // The friend's failure is theirs alone: the owner, and a guest who hasn't been in yet, are served as ever.
    for (const headers of [app.headers, await app.headersFor("mum@example.com")]) {
      const saved = await app.app.inject({ method: "PUT", url: "/api/profile", headers, payload: PROFILE });
      expect(saved.statusCode).toBe(200);
    }
    // The failure is in the log, by the first 8 characters of the folder's name (sha256 of the friend's email) and nothing more.
    const logged = lines.join("");
    expect(logged).toContain("users/f387373a…");
    expect(logged).not.toContain(personKey(FRIEND));
    expect(logged).not.toContain("@");
  });
});
