export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  ownerEmail: string;
  /** A JSON key set that replaces Cloudflare's — for tests and local development; always null in production. */
  testJwks: string | null;
}

export interface Config {
  nodeEnv: "production" | "development" | "test";
  port: number;
  metricsPort: number;
  dataDir: string;
  webDist: string | null;
  /** Null only in development with DEV_AUTH_EMAIL. */
  access: AccessConfig | null;
  devAuthEmail: string | null;
  anthropic: { apiKey: string | null; model: string; effort: Effort };
  coachBudgetMs: number;
  snapshotKeep: number;
  /** How long conversations and photos are kept (spec §6.6). */
  retentionHours: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function trimmed(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function positiveInt(env: Env, name: string, fallback: number, max = Infinity): number {
  const raw = trimmed(env, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    const limit = Number.isFinite(max) ? ` of at most ${max}` : "";
    throw new ConfigError(`${name} must be a positive integer${limit}, got "${raw}"`);
  }
  return value;
}

/** A year. A longer retention window is refused: past this, the cutoff date can overflow what a Date holds. */
const MAX_RETENTION_HOURS = 24 * 365;

export function loadConfig(env: Env): Config {
  // Only an explicit "development" or "test" counts, so a container that forgets
  // NODE_ENV can never switch the development sign-in bypass on.
  const nodeEnv = env.NODE_ENV === "development" || env.NODE_ENV === "test" ? env.NODE_ENV : "production";

  const devAuthEmail = trimmed(env, "DEV_AUTH_EMAIL")?.toLowerCase() ?? null;
  if (devAuthEmail && nodeEnv !== "development") {
    throw new ConfigError("DEV_AUTH_EMAIL is only allowed when NODE_ENV=development");
  }

  const teamDomain = trimmed(env, "ACCESS_TEAM_DOMAIN");
  const audience = trimmed(env, "ACCESS_AUD");
  const ownerEmail = trimmed(env, "OWNER_EMAIL")?.toLowerCase() ?? null;
  let access: AccessConfig | null = null;
  if (teamDomain && audience && ownerEmail) {
    access = { teamDomain, audience, ownerEmail, testJwks: nodeEnv === "production" ? null : trimmed(env, "ACCESS_TEST_JWKS") };
  } else if (!devAuthEmail) {
    throw new ConfigError(
      "ACCESS_TEAM_DOMAIN, ACCESS_AUD and OWNER_EMAIL must all be set. Refusing to start: without them no request can be authenticated.",
    );
  }

  const effort = trimmed(env, "ANTHROPIC_EFFORT") ?? "medium";
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new ConfigError(`ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}, got "${effort}"`);
  }

  return {
    nodeEnv,
    port: positiveInt(env, "PORT", 8080),
    metricsPort: positiveInt(env, "METRICS_PORT", 9464),
    dataDir: trimmed(env, "DATA_DIR") ?? "./.data",
    webDist: trimmed(env, "WEB_DIST"),
    access,
    devAuthEmail,
    anthropic: {
      apiKey: trimmed(env, "ANTHROPIC_API_KEY"),
      model: trimmed(env, "ANTHROPIC_MODEL") ?? "claude-opus-5-5",
      effort: effort as Effort,
    },
    coachBudgetMs: positiveInt(env, "COACH_BUDGET_MS", 90_000),
    snapshotKeep: positiveInt(env, "SNAPSHOT_KEEP", 7),
    retentionHours: positiveInt(env, "RETENTION_HOURS", 48, MAX_RETENTION_HOURS),
  };
}
