import type { Verifier } from "./auth/access.ts";
import type { Sql } from "./db/types.ts";

/** Everything the HTTP layer needs, injected so tests can replace any of it. */
export interface AppDeps {
  db: Sql;
  verifier: Verifier;
  now: () => Date;
  /** The built PWA (web/dist); null in development and in tests. */
  webDist: string | null;
  logger?: boolean;
}
