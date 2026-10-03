import type { AiClient } from "./ai/client.ts";
import type { Verifier } from "./auth/access.ts";
import type { Sql } from "./db/types.ts";

/** Everything the HTTP layer needs, injected so tests can replace any of it. */
export interface AppDeps {
  db: Sql;
  verifier: Verifier;
  now: () => Date;
  /** The built PWA (web/dist); null in development and in tests. */
  webDist: string | null;
  /** Null when ANTHROPIC_API_KEY is unset: the coach is off, manual logging still works. */
  ai: AiClient | null;
  /** Total time one coach message may take; under Cloudflare's 100 s proxy timeout. */
  coachBudgetMs: number;
  logger?: boolean;
}
