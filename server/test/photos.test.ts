import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectImageType, imageSize } from "../src/photos/images.ts";
import { MAX_PHOTO_BYTES, claimPhotos, getPhoto, savePhoto } from "../src/photos/photos.ts";
import { fakeJpeg, fakePng } from "./images.ts";
import { NOW, openTestDb, tempDir, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const upload = (app: TestApp, body: Buffer | string, type = "image/jpeg", headers: Record<string, string> = app.headers) =>
  app.app.inject({ method: "POST", url: "/api/photos", headers: { ...headers, "content-type": type }, payload: body });

const imageFiles = (dir: string) => fs.readdirSync(dir).filter((f) => /\.(jpg|png)$/.test(f));

describe("image checks", () => {
  it("recognise JPEG and PNG from their bytes", () => {
    expect(detectImageType(fakeJpeg(10, 20))).toBe("image/jpeg");
    expect(detectImageType(fakePng(10, 20))).toBe("image/png");
    expect(detectImageType(Buffer.from("GIF89a"))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it("read the size from the header, skipping segments before the frame", () => {
    expect(imageSize(fakeJpeg(1568, 1176), "image/jpeg")).toEqual({ width: 1568, height: 1176 });
    expect(imageSize(fakePng(640, 480), "image/png")).toEqual({ width: 640, height: 480 });
    const progressive = fakeJpeg(300, 200);
    progressive[2 + 18 + 1] = 0xc2; // the frame marker after SOI and APP0 becomes SOF2
    expect(imageSize(progressive, "image/jpeg")).toEqual({ width: 300, height: 200 });
  });

  it("find no size in a truncated or frameless file", () => {
    expect(imageSize(fakeJpeg(10, 10).subarray(0, 12), "image/jpeg")).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")).toBeNull();
    expect(imageSize(fakePng(10, 10).subarray(0, 20), "image/png")).toBeNull();
    expect(imageSize(fakeJpeg(0, 10), "image/jpeg")).toBeNull();
  });

  it("find no size in a file that stops inside its frame header", () => {
    // The JPEG's size field is bytes 25 to 28 and the PNG's is 16 to 23: cut one byte short.
    expect(imageSize(fakeJpeg(10, 10).subarray(0, 28), "image/jpeg")).toBeNull();
    expect(imageSize(fakePng(10, 10).subarray(0, 23), "image/png")).toBeNull();
  });

  it("do not mistake a near miss for an image", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull(); // a JPEG starts FF D8 FF
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // half a PNG signature
    const nearPng = fakePng(10, 10);
    nearPng[7] = 0x0b; // the signature's last byte
    expect(detectImageType(nearPng)).toBeNull();
  });
});

describe("POST /api/photos", () => {
  it("stores a JPEG and describes it", async () => {
    ctx = await testApp();
    const bytes = fakeJpeg(1568, 1176);
    const res = await upload(ctx, bytes);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), media_type: "image/jpeg", bytes: bytes.length, width: 1568, height: 1176 });
    expect(fs.readFileSync(path.join(ctx.photoDir, `${body.id}.jpg`)).equals(bytes)).toBe(true);
    expect(getPhoto(ctx.db, body.id)).toMatchObject({ message_id: null, created_at: NOW.toISOString() });
  });

  it("goes by the bytes, not the declared type", async () => {
    ctx = await testApp();
    const res = await upload(ctx, fakePng(64, 48), "image/jpeg");
    expect(res.json()).toMatchObject({ media_type: "image/png" });
    expect(fs.existsSync(path.join(ctx.photoDir, `${res.json().id}.png`))).toBe(true);
  });

  it("refuses what is not a JPEG or PNG, and writes nothing", async () => {
    ctx = await testApp();
    expect((await upload(ctx, "not a picture", "image/png")).json()).toEqual({ error: "not_an_image" });
    expect((await upload(ctx, Buffer.alloc(0))).statusCode).toBe(400);
    const json = await ctx.app.inject({ method: "POST", url: "/api/photos", headers: ctx.headers, payload: { a: 1 } });
    expect(json.statusCode).toBe(400);
    // Fastify parses JSON and text itself; any other type without a parser is refused before the handler.
    expect((await upload(ctx, "hello", "application/octet-stream")).statusCode).toBe(415);
    expect(imageFiles(ctx.photoDir)).toEqual([]);
  });

  it("refuses more than 8 MB", async () => {
    ctx = await testApp();
    const res = await upload(ctx, fakeJpeg(10, 10, MAX_PHOTO_BYTES));
    expect(res.statusCode).toBe(413);
    expect(imageFiles(ctx.photoDir)).toEqual([]);
  });

  it("accepts a photo of exactly 8 MB, far over the app's 1 MB body limit", async () => {
    ctx = await testApp();
    const bytes = fakeJpeg(10, 10, MAX_PHOTO_BYTES - fakeJpeg(10, 10).length);
    expect(bytes.length).toBe(MAX_PHOTO_BYTES);
    const res = await upload(ctx, bytes);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ bytes: MAX_PHOTO_BYTES });
    fs.rmSync(path.join(ctx.photoDir, `${res.json().id}.jpg`)); // eight megabytes are not worth leaving in the temp folder
  });

  it("needs the owner's sign-in, like every API route", async () => {
    ctx = await testApp();
    expect((await upload(ctx, fakeJpeg(10, 10), "image/jpeg", {})).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: `/api/photos/${"a".repeat(32)}` })).statusCode).toBe(401);
  });
});

describe("GET /api/photos/:id", () => {
  it("serves the photo privately, cached for its lifetime, never sniffed", async () => {
    ctx = await testApp();
    const bytes = fakeJpeg(20, 10);
    const { id } = (await upload(ctx, bytes)).json();
    const res = await ctx.app.inject({ method: "GET", url: `/api/photos/${id}`, headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("private, max-age=172800, immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it("answers 404 for an unknown or malformed id, and when the file has gone", async () => {
    ctx = await testApp();
    const get = (id: string) => ctx!.app.inject({ method: "GET", url: `/api/photos/${id}`, headers: ctx!.headers });
    expect((await get("0".repeat(32))).statusCode).toBe(404);
    expect((await get("../../etc/passwd")).statusCode).toBe(404);
    const { id } = (await upload(ctx, fakeJpeg(5, 5))).json();
    fs.rmSync(path.join(ctx.photoDir, `${id}.jpg`));
    expect((await get(id)).statusCode).toBe(404);
  });
});

describe("savePhoto", () => {
  it("leaves no file behind when the row cannot be recorded", () => {
    const db = openTestDb();
    const dir = tempDir();
    db.sqlite.exec("DROP TABLE photos");
    expect(() => savePhoto(db.db, dir, fakeJpeg(4, 4), NOW.toISOString())).toThrow(/no such table/);
    expect(fs.readdirSync(dir)).toEqual([]);
    db.close();
  });
});

describe("claimPhotos", () => {
  it("gives each photo to one message; the same message may claim it again", () => {
    const db = openTestDb();
    const dir = tempDir();
    const save = () => {
      const result = savePhoto(db.db, dir, fakeJpeg(4, 4), NOW.toISOString());
      if (!result.ok) throw new Error("save failed");
      return result.photo.id;
    };
    const [a, b] = [save(), save()];
    expect(claimPhotos(db.db, [a, b], "m1")).toEqual({ ok: true });
    expect(claimPhotos(db.db, [a], "m1")).toEqual({ ok: true });
    expect(claimPhotos(db.db, [a], "m2")).toEqual({ ok: false, error: "photo_taken" });
    expect(claimPhotos(db.db, ["f".repeat(32)], "m3")).toEqual({ ok: false, error: "photo_not_found" });
    expect(getPhoto(db.db, b)?.message_id).toBe("m1");
    db.close();
  });
});
