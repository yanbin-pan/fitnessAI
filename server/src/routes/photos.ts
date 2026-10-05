import type { FastifyInstance } from "fastify";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { MAX_PHOTO_BYTES, PHOTO_ID, getPhoto, readPhoto, savePhoto } from "../photos/photos.ts";
import { answerError } from "./http.ts";

/** Fastify's refusal of a body over its parser's limit. */
function isBodyTooLarge(err: unknown): boolean {
  const e = err as { statusCode?: unknown; code?: unknown } | null;
  return e?.statusCode === 413 || e?.code === "FST_ERR_CTP_BODY_TOO_LARGE";
}

export function registerPhotoRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  // A context of their own: image bodies are parsed for these routes only, and a body over the
  // limit is answered as a photo too large. The app's onRequest hook (the sign-in) is
  // registered before this context exists, so it still runs first.
  void app.register(async (photos) => {
    // The body is the image itself. Its declared type only gets it parsed; the bytes decide (spec §6.5).
    // The parser's limit is the only one: JSON or text sent here keeps the app's 1 MiB.
    photos.addContentTypeParser(["image/jpeg", "image/png"], { parseAs: "buffer", bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) => {
      done(null, body);
    });

    photos.setErrorHandler((err, req, reply) => {
      if (isBodyTooLarge(err)) return reply.code(413).send({ error: "image_too_large" });
      return answerError(err, req, reply);
    });

    photos.post("/api/photos", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      // Only an image body arrives as a Buffer; JSON or text was parsed into something else.
      if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: "not_an_image" });
      const result = savePhoto(deps.db, deps.photoDir, req.body, deps.now().toISOString());
      if (!result.ok) return reply.code(400).send({ error: result.error });
      const { id, media_type, bytes, width, height } = result.photo;
      return reply.code(201).send({ id, media_type, bytes, width, height });
    });

    photos.get<{ Params: { id: string } }>("/api/photos/:id", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const photo = PHOTO_ID.test(req.params.id) ? getPhoto(deps.db, req.params.id) : null;
      const bytes = photo ? readPhoto(deps.photoDir, photo) : null;
      if (!photo || !bytes) return reply.code(404).send({ error: "not_found" });
      return reply
        .header("content-type", photo.media_type)
        .header("cache-control", "private, max-age=172800, immutable")
        .header("x-content-type-options", "nosniff")
        .send(bytes);
    });
  });
}
