import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MISSING_PHOTO_TEXT, PHOTOS_ONLY_TEXT } from "../src/coach/photo-blocks.ts";
import { coachTurns } from "../src/db/schema.ts";
import { savePhoto } from "../src/photos/photos.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { fakeJpeg, fakePng } from "./images.ts";
import { NOW, logItemsInput, makeProfile, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function appWith(steps: FakeStep[]) {
  const ai = fakeAi(steps);
  ctx = await testApp({ ai });
  saveProfile(ctx.db, makeProfile(), NOW.toISOString());
  return { app: ctx, ai };
}

function addPhoto(app: TestApp, bytes: Buffer): string {
  const saved = savePhoto(app.db, app.photoDir, bytes, NOW.toISOString());
  if (!saved.ok) throw new Error("the test photo was refused");
  return saved.photo.id;
}

function send(app: TestApp, body: { text?: string; photo_ids?: string[] }) {
  return app.app.inject({
    method: "POST", url: "/api/messages", headers: app.headers,
    payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", text: "", photo_ids: [], ...body },
  });
}

type Block = { type: string; text?: string; source?: { type: string; media_type: string; data: string } };
const blocksOf = (message: { content: unknown }) => message.content as Block[];

describe("the coach and photos", () => {
  it("gets the photos as images, in the order attached, between the context and the text", async () => {
    const { app, ai } = await appWith([textReply("Porridge and a coffee.")]);
    const jpeg = fakeJpeg(30, 20);
    const png = fakePng(10, 10);
    await send(app, { text: "breakfast", photo_ids: [addPhoto(app, jpeg), addPhoto(app, png)] });
    const blocks = blocksOf(ai.requests[0].messages[0]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "image", "text"]);
    expect(blocks[0].text).toContain("Context for this message");
    expect(blocks[1].source).toEqual({ type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") });
    expect(blocks[2].source).toEqual({ type: "base64", media_type: "image/png", data: png.toString("base64") });
    expect(blocks[3].text).toBe("breakfast");
  });

  it("says when a message is only photos", async () => {
    const { app, ai } = await appWith([textReply("Noted.")]);
    await send(app, { photo_ids: [addPhoto(app, fakeJpeg(30, 20))] });
    expect(blocksOf(ai.requests[0].messages[0]).at(-1)?.text).toBe(PHOTOS_ONLY_TEXT);
  });

  it("stores a reference for each photo, never the image", async () => {
    const { app } = await appWith([textReply("Noted.")]);
    const jpeg = fakeJpeg(30, 20);
    const id = addPhoto(app, jpeg);
    await send(app, { text: "lunch", photo_ids: [id] });
    const [userTurn] = app.db.select().from(coachTurns).all();
    expect(userTurn.blocks).toContainEqual({ type: "photo_ref", photo_id: id });
    expect(JSON.stringify(userTurn.blocks)).not.toContain(jpeg.toString("base64"));
  });

  it("replays an earlier photo byte for byte, so the day's cache and thinking stay valid", async () => {
    const { app, ai } = await appWith([textReply("Noted."), textReply("Sure.")]);
    await send(app, { text: "lunch", photo_ids: [addPhoto(app, fakeJpeg(30, 20))] });
    await send(app, { text: "and a coffee after?" });
    expect(JSON.stringify(ai.requests[1].messages[0])).toBe(JSON.stringify(ai.requests[0].messages[0]));
  });

  it("replays a photo whose file has gone as a short note", async () => {
    const { app, ai } = await appWith([textReply("Noted."), textReply("Sure.")]);
    const id = addPhoto(app, fakeJpeg(30, 20));
    await send(app, { text: "lunch", photo_ids: [id] });
    fs.rmSync(path.join(app.photoDir, `${id}.jpg`));
    await send(app, { text: "anything else?" });
    expect(blocksOf(ai.requests[1].messages[0])[1]).toEqual({ type: "text", text: MISSING_PHOTO_TEXT });
  });

  it("marks what it logs from a photo message as from a photo", async () => {
    const { app } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    const res = await send(app, { photo_ids: [addPhoto(app, fakeJpeg(30, 20))] });
    expect(res.json().day.entries[0].source).toBe("photo");
  });

  it("sends and stores a text-only message as just the context and the text, as before photos existed", async () => {
    const { app, ai } = await appWith([textReply("Sure.")]);
    await send(app, { text: "how much is left?" });
    const sent = blocksOf(ai.requests[0].messages[0]);
    expect(sent.map((b) => b.type)).toEqual(["text", "text"]);
    expect(sent[1].text).toBe("how much is left?");
    const [userTurn] = app.db.select().from(coachTurns).all();
    expect(userTurn.blocks).toEqual(sent);
  });

  it("still marks text-only logging as the coach's", async () => {
    const { app } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    const res = await send(app, { text: "2 scrambled eggs" });
    expect(res.json().day.entries[0].source).toBe("coach");
  });
});
