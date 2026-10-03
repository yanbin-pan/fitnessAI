/**
 * The error serializer for every log line. Drizzle puts a failed query's parameters
 * (message text, food names, body values) in its error's message and properties;
 * none of that may reach the logs (spec §13).
 */
function scrubbed(err: Error): string {
  return "params" in err ? "database query failed" : err.message;
}

/** The shape Fastify's logger types require of an error serializer. */
interface SerializedError {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
}

export function serializeError(err: unknown): SerializedError {
  if (!(err instanceof Error)) return { type: typeof err, message: "", stack: "" };
  const cause = err.cause instanceof Error ? err.cause : undefined;
  return {
    type: err.name,
    message: scrubbed(err),
    code: (err as { code?: unknown }).code ?? (cause as { code?: unknown } | undefined)?.code,
    stack: "params" in err ? "" : (err.stack ?? ""),
    cause: cause ? { type: cause.name, message: scrubbed(cause) } : undefined,
  };
}

/** Fastify's logger options: pino, with the error serializer above. */
export const LOGGER = { serializers: { err: serializeError } };
