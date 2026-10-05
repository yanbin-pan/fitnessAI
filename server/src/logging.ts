/**
 * The error serializer for every log line. Drizzle's async SQLite drivers wrap a failed
 * query in a DrizzleQueryError whose message and properties carry the query's parameters
 * (message text, food names, body values). The better-sqlite3 driver used here throws a
 * bare SqliteError without values, so this is defence in depth (spec §13).
 */
function scrubbed(err: Error): string {
  return "params" in err ? "database query failed" : err.message;
}

/** A person's folder is named by a hash of their email: logs show only its first 8 characters (2.2 §8). */
const PERSON_FOLDER = /(users[\\/])([0-9a-f]{8})[0-9a-f]{56}/g;
const shortened = (text: string) => text.replace(PERSON_FOLDER, "$1$2…");

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
  // fs errors carry the path they failed on, and a person's path holds their whole key: shorten it everywhere text is kept.
  return {
    type: err.name,
    message: shortened(scrubbed(err)),
    code: (err as { code?: unknown }).code ?? (cause as { code?: unknown } | undefined)?.code,
    stack: "params" in err ? "" : shortened(err.stack ?? ""),
    cause: cause ? { type: cause.name, message: shortened(scrubbed(cause)) } : undefined,
  };
}

/** Fastify's logger options: pino, with the error serializer above. */
export const LOGGER = { serializers: { err: serializeError } };
