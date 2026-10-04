import type { FastifyReply } from "fastify";
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
