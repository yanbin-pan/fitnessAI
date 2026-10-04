import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

/** Parses a request body. On failure sends a 400 listing each problem and returns null. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.output<T> | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  void reply.code(400).send({
    error: "invalid_request",
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return null;
}

/** The app's answer to an error no route handled: a client error keeps its 4xx status, anything else is a logged 500. */
export function answerError(err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  // Fastify types the error as unknown; client errors (bad JSON, body too large) carry a 4xx statusCode.
  const code = (err as { statusCode?: unknown }).statusCode;
  const status = typeof code === "number" && code < 500 ? code : 500;
  if (status === 500) req.log.error({ err }, "unhandled error");
  return reply.code(status).send({ error: status === 500 ? "internal" : "bad_request" });
}
