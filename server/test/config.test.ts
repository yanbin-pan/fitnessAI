import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const production = {
  NODE_ENV: "production",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "aud",
  OWNER_EMAIL: "Owner@Example.com",
};

describe("loadConfig", () => {
  it("loads production settings with the documented defaults", () => {
    const c = loadConfig(production);
    expect(c).toMatchObject({
      nodeEnv: "production", port: 8080, metricsPort: 9464, dataDir: "./.data", webDist: null,
      devAuthEmail: null, coachBudgetMs: 90_000, snapshotKeep: 7, aiDailyCallCap: 200, guestDailyCallCap: 60,
    });
    expect(c.access).toEqual({ teamDomain: "team.cloudflareaccess.com", audience: "aud", ownerEmail: "owner@example.com", allowedEmails: [], testJwks: null });
    expect(c.ownerEmail).toBe("owner@example.com");
    expect(c.anthropic).toEqual({ apiKey: null, model: "claude-opus-5-5", effort: "medium" });
  });

  it("treats a missing NODE_ENV as production", () => {
    const { NODE_ENV: _omitted, ...rest } = production;
    expect(loadConfig(rest).nodeEnv).toBe("production");
  });

  it("refuses to start without the Access settings", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, OWNER_EMAIL: " " })).toThrow(ConfigError);
  });

  it("lets in the addresses on ALLOWED_EMAILS: trimmed, lowercased, each once, the owner left out", () => {
    const c = loadConfig({ ...production, ALLOWED_EMAILS: " Friend@Example.com, mum@example.com,,friend@example.com , OWNER@example.com " });
    expect(c.access?.allowedEmails).toEqual(["friend@example.com", "mum@example.com"]);
    expect(loadConfig({ ...production, ALLOWED_EMAILS: "  " }).access?.allowedEmails).toEqual([]);
  });

  it("refuses an ALLOWED_EMAILS entry that isn't an address, by its position and without repeating it", () => {
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com mum@example.com" })).toThrow(
      /^ALLOWED_EMAILS entry 1 is not an email address$/,
    );
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com;mum@example.com" })).toThrow(
      /^ALLOWED_EMAILS entry 1 is not an email address$/,
    );
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com, mum" })).toThrow(/^ALLOWED_EMAILS entry 2 is not an email address$/);
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com, mum" })).toThrow(ConfigError);
  });

  it("only honours DEV_AUTH_EMAIL in development", () => {
    expect(() => loadConfig({ ...production, DEV_AUTH_EMAIL: "dev@localhost" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, NODE_ENV: "test", DEV_AUTH_EMAIL: "dev@localhost" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, NODE_ENV: undefined, DEV_AUTH_EMAIL: "dev@localhost" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, NODE_ENV: "dev", DEV_AUTH_EMAIL: "dev@localhost" })).toThrow(ConfigError);
    const dev = loadConfig({ NODE_ENV: "development", DEV_AUTH_EMAIL: "Dev@Localhost" });
    expect(dev.devAuthEmail).toBe("dev@localhost");
    expect(dev.access).toBeNull();
  });

  it("makes the development sign-in the owner", () => {
    expect(loadConfig({ NODE_ENV: "development", DEV_AUTH_EMAIL: "Dev@Localhost" }).ownerEmail).toBe("dev@localhost");
    expect(loadConfig({ ...production, NODE_ENV: "development", DEV_AUTH_EMAIL: "dev@localhost" }).ownerEmail).toBe("dev@localhost");
  });

  it("ignores ACCESS_TEST_JWKS in production", () => {
    expect(loadConfig({ ...production, ACCESS_TEST_JWKS: "{}" }).access?.testJwks).toBeNull();
    expect(loadConfig({ ...production, NODE_ENV: "test", ACCESS_TEST_JWKS: "{}" }).access?.testJwks).toBe("{}");
  });

  it("reads the Anthropic settings", () => {
    const c = loadConfig({ ...production, ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_EFFORT: "low" });
    expect(c.anthropic).toEqual({ apiKey: "k", model: "claude-sonnet-5-5", effort: "low" });
  });

  it("reads the port, path and budget overrides", () => {
    const c = loadConfig({
      ...production, PORT: "9000", METRICS_PORT: "9100", DATA_DIR: "/data", WEB_DIST: "/app/web/dist",
      COACH_BUDGET_MS: "60000", SNAPSHOT_KEEP: "3",
    });
    expect(c).toMatchObject({ port: 9000, metricsPort: 9100, dataDir: "/data", webDist: "/app/web/dist", coachBudgetMs: 60_000, snapshotKeep: 3 });
  });

  it("reads the owner's and each guest's daily call caps", () => {
    const c = loadConfig({ ...production, AI_DAILY_CALL_CAP: "150", GUEST_DAILY_CALL_CAP: "25" });
    expect([c.aiDailyCallCap, c.guestDailyCallCap]).toEqual([150, 25]);
    expect(() => loadConfig({ ...production, GUEST_DAILY_CALL_CAP: "0" })).toThrow(ConfigError);
  });

  it("rejects an unknown effort level and a bad port", () => {
    expect(() => loadConfig({ ...production, ANTHROPIC_EFFORT: "extreme" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, PORT: "eighty" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, PORT: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, METRICS_PORT: "-1" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, SNAPSHOT_KEEP: "2.5" })).toThrow(ConfigError);
  });
});
