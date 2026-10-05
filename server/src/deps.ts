import type { FastifyRequest } from "fastify";
import type { AiClient } from "./ai/client.ts";
import type { Verifier } from "./auth/access.ts";
import type { Sql } from "./db/types.ts";
import type { Metrics } from "./metrics.ts";
import type { People, Person } from "./people/people.ts";

/** Everything the HTTP layer needs, injected so tests can replace any of it. */
export interface AppDeps {
  /** Everyone's data: a database and a photo folder per person (2.2 §4). */
  people: People;
  verifier: Verifier;
  now: () => Date;
  /** The built PWA (web/dist); null in development and in tests. */
  webDist: string | null;
  /** Null when ANTHROPIC_API_KEY is unset: the coach is off, manual logging still works. */
  ai: AiClient | null;
  /** Total time one coach message may take; under Cloudflare's 100 s proxy timeout. */
  coachBudgetMs: number;
  logger?: boolean;
  /** Tests only: where log lines go when logger is on. */
  logStream?: { write(line: string): void };
  metrics?: Metrics;
  /** How often a live-steps stream says it is still there (spec §6.3); 15 s unless a test changes it. */
  streamKeepAliveMs?: number;
}

/** What a route works with: the app's dependencies, with the signed-in person's database and photos. */
export interface RequestDeps extends Omit<AppDeps, "people"> {
  person: Person;
  db: Sql;
  /** Where this person's photos live: <DATA_DIR>/users/<key>/photos (spec §6.5). */
  photoDir: string;
}

/** The app's dependencies for this request's person. Every /api route runs after the sign-in hook has set one. */
export function forRequest(deps: AppDeps, req: FastifyRequest): RequestDeps {
  const person = req.person;
  if (!person) throw new Error("this request has no signed-in person");
  return { ...deps, person, db: person.db, photoDir: person.photoDir };
}
