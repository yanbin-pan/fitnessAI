export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** The model the coach and the insights call when ANTHROPIC_MODEL is unset; its list price is in ai/pricing.ts. */
export const DEFAULT_MODEL = "claude-opus-5-5";

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  ownerEmail: string;
  /** Everyone else who may sign in (ALLOWED_EMAILS), lowercased, the owner left out; empty means the owner alone (2.2 §3). */
  allowedEmails: readonly string[];
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
  /** The owner: OWNER_EMAIL, or DEV_AUTH_EMAIL when development skips Access (2.2 §3). */
  ownerEmail: string;
  anthropic: { apiKey: string | null; model: string; effort: Effort };
  coachBudgetMs: number;
  snapshotKeep: number;
  /** Model calls a day for the owner (AI_DAILY_CALL_CAP) and for each guest (GUEST_DAILY_CALL_CAP) (2.2 §6). */
  aiDailyCallCap: number;
  guestDailyCallCap: number;
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

/** A comma-separated list of addresses, lowercased and trimmed, each once. A bad entry is named by its position:
 * the error goes to the pod's log, which never holds an email (2.2 §8). */
function emailList(env: Env, name: string): string[] {
  const emails: string[] = [];
  for (const [index, part] of (env[name] ?? "").split(",").entries()) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new ConfigError(`${name} entry ${index + 1} is not an email address`);
    if (!emails.includes(email)) emails.push(email);
  }
  return emails;
}

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
    const allowedEmails = emailList(env, "ALLOWED_EMAILS").filter((email) => email !== ownerEmail);
    access = { teamDomain, audience, ownerEmail, allowedEmails, testJwks: nodeEnv === "production" ? null : trimmed(env, "ACCESS_TEST_JWKS") };
  } else if (!devAuthEmail) {
    throw new ConfigError(
      "ACCESS_TEAM_DOMAIN, ACCESS_AUD and OWNER_EMAIL must all be set. Refusing to start: without them no request can be authenticated.",
    );
  }

  const effort = trimmed(env, "ANTHROPIC_EFFORT") ?? "medium";
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new ConfigError(`ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}, got "${effort}"`);
  }

  // The development bypass signs its one person in as the owner; otherwise the owner is OWNER_EMAIL.
  const owner = devAuthEmail ?? access?.ownerEmail ?? null;
  if (owner === null) throw new ConfigError("OWNER_EMAIL must be set"); // unreachable: refused above already

  return {
    nodeEnv,
    port: positiveInt(env, "PORT", 8080),
    metricsPort: positiveInt(env, "METRICS_PORT", 9464),
    dataDir: trimmed(env, "DATA_DIR") ?? "./.data",
    webDist: trimmed(env, "WEB_DIST"),
    access,
    devAuthEmail,
    ownerEmail: owner,
    anthropic: {
      apiKey: trimmed(env, "ANTHROPIC_API_KEY"),
      model: trimmed(env, "ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
      effort: effort as Effort,
    },
    coachBudgetMs: positiveInt(env, "COACH_BUDGET_MS", 90_000),
    snapshotKeep: positiveInt(env, "SNAPSHOT_KEEP", 7),
    aiDailyCallCap: positiveInt(env, "AI_DAILY_CALL_CAP", 200),
    guestDailyCallCap: positiveInt(env, "GUEST_DAILY_CALL_CAP", 60),
  };
}
