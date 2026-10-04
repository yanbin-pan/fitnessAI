import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { MAX_PHOTO_BYTES, PHOTO_ID, getPhoto, readPhoto, savePhoto } from "../photos/photos.ts";

export function registerPhotoRoutes(app: FastifyInstance, deps: AppDeps): void {
  // The body is the image itself. Its declared type only gets it parsed; the bytes decide (spec §6.5).
  app.addContentTypeParser(["image/jpeg", "image/png"], { parseAs: "buffer", bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/api/photos", { bodyLimit: MAX_PHOTO_BYTES }, async (req, reply) => {
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    const result = body ? savePhoto(deps.db, deps.photoDir, body, deps.now().toISOString()) : null;
    if (!result || !result.ok) return reply.code(400).send({ error: "not_an_image" });
    const { id, media_type, bytes, width, height } = result.photo;
    return reply.code(201).send({ id, media_type, bytes, width, height });
  });

  app.get<{ Params: { id: string } }>("/api/photos/:id", async (req, reply) => {
    const photo = PHOTO_ID.test(req.params.id) ? getPhoto(deps.db, req.params.id) : null;
    const bytes = photo ? readPhoto(deps.photoDir, photo) : null;
    if (!photo || !bytes) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("content-type", photo.media_type)
      .header("cache-control", "private, max-age=172800, immutable")
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });
}
