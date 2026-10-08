import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import type { AiUsage } from "../src/ai/client.ts";
import { PRICES, costDollars } from "../src/ai/pricing.ts";
import { recordRun, tokensByModel } from "../src/coach/usage.ts";
import { DEFAULT_MODEL } from "../src/config.ts";
import { personPaths, preparePersonDir } from "../src/db/location.ts";
import { createMetrics, personLabels, registerSpend } from "../src/metrics.ts";
import { personKey } from "../src/people/people.ts";
import type { People, Store } from "../src/people/people.ts";
import { spendByPerson, spendReader } from "../src/spend.ts";
import type { SpendReport } from "../src/spend.ts";
import { NOW, openTestDb, testPeople } from "./helpers.ts";

const OWNER_KEY = personKey("owner@example.com");
const FRIEND = "friend@example.com";
const FRIEND_KEY = personKey(FRIEND);
// How metrics name a person: the first 8 hex characters of sha256(email) (2.2 §8), and owner or guest.
const OWNER = { person: "c8cd3c64", role: "owner" } as const;
const GUEST = { person: "f387373a", role: "guest" } as const;
const NO_TOKENS: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** One recorded run, as the coach or the weekly insights write it. */
const run = (messageId: string, model: string | null, usage: Partial<AiUsage>) => ({
  messageId, date: "2026-10-03", model, calls: 1, usage: { ...NO_TOKENS, ...usage }, nowIso: NOW.toISOString(),
});
/** Dollars rounded to a millionth, so float noise doesn't decide a comparison. */
const rounded = (dollars: number) => Math.round(dollars * 1e6) / 1e6;
/** spendByPerson's answer as plain rows, sorted by person. */
const rows = (spend: ReturnType<typeof spendByPerson>) =>
  spend.map(({ person, dollars }) => ({ ...personLabels(person), dollars: rounded(dollars) })).sort((a, b) => a.person.localeCompare(b.person));
/** A report that keeps what it was told. */
function collect() {
  const unpriced: string[] = [];
  const failed: string[] = [];
  const report: SpendReport = { unpriced: (model) => unpriced.push(model), failed: (key) => failed.push(key) };
  return { report, unpriced, failed };
}
/** The spend metric's series as exposed (`name{labels} value`), sorted. */
const spendSeries = (text: string) => text.split("\n").filter((line) => line.startsWith("fitnessai_ai_cost_dollars_total{")).sort();
/** A person whose usage records can't be read, as a database on a failing disk would behave. */
const unreadable = { key: FRIEND_KEY, db: { select: () => { throw new Error("SQLITE_IOERR: disk I/O error"); } } } as unknown as Store;

describe("costDollars", () => {
  it("prices each kind of token at the model's list price per million", () => {
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, input_tokens: 1_000_000 })).toBeCloseTo(4, 9);
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, output_tokens: 1_000_000 })).toBeCloseTo(20, 9);
    // Claude Opus 5.5 reads the cache at 0.05x input, and the app writes it at the 5-minute rate, 1.25x.
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2, 9);
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5, 9);
    // A coach run: 3,000 new input tokens, 40,000 read from the cache, 2,000 written to it, 800 out.
    const usage = { input_tokens: 3000, output_tokens: 800, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000 };
    expect(costDollars("claude-opus-5-5", usage)).toBeCloseTo(0.012 + 0.016 + 0.008 + 0.01, 9);
  });

  // The pricing page's pattern, so a typo in one cell (25 for 2.5) fails: output 5x input, a 5-minute cache write 1.25x,
  // a cache read 0.1x, except Claude Opus 5.5's 0.05x and Claude Fable 5.1's 0.025x.
  it("prices every model in the table on the pricing page's pattern", () => {
    const readShare: Record<string, number> = { "claude-opus-5-5": 0.05, "claude-fable-5-1": 0.025 };
    for (const [model, price] of Object.entries(PRICES)) {
      expect(price.output, model).toBeCloseTo(price.input * 5, 9);
      expect(price.cacheWrite, model).toBeCloseTo(price.input * 1.25, 9);
      expect(price.cacheRead, model).toBeCloseTo(price.input * (readShare[model] ?? 0.1), 9);
    }
  });

  it("prices a dated snapshot as its alias", () => {
    const usage = { ...NO_TOKENS, output_tokens: 1_000_000 };
    expect(costDollars("claude-haiku-4-5-20251001", usage)).toBeCloseTo(5, 9);
  });

  it("has no price for a model missing from the table, nor for an object's own property names", () => {
    expect(costDollars("claude-unknown-1", { ...NO_TOKENS, input_tokens: 10 })).toBeNull();
    expect(costDollars("constructor", { ...NO_TOKENS, input_tokens: 10 })).toBeNull();
    expect(costDollars("toString", { ...NO_TOKENS, input_tokens: 10 })).toBeNull();
  });

  // Switching the model without adding its price would quietly leave every call out of the dashboard's estimate.
  it("has a price for the model the cluster runs", () => {
    const manifest = fs.readFileSync(new URL("../../k8s/30-app.yaml", import.meta.url), "utf8");
    const configured = /name: ANTHROPIC_MODEL\s+value: "?([\w.-]+)"?/.exec(manifest)?.[1];
    // Without the variable the app calls its default model.
    const model = manifest.includes("ANTHROPIC_MODEL") ? configured : DEFAULT_MODEL;
    expect(model, "k8s/30-app.yaml sets ANTHROPIC_MODEL in a form this test can't read").toBeDefined();
    expect(PRICES[model!], `add ${model}'s list price to server/src/ai/pricing.ts`).toBeDefined();
  });
});

describe("tokensByModel", () => {
  it("adds up every recorded run per model, the coach's and the weekly insights' alike", () => {
    const database = openTestDb();
    try {
      recordRun(database.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 }));
      recordRun(database.db, run("insights:2026-09-28", "claude-opus-5-5", { input_tokens: 2000, output_tokens: 500 }));
      // A request a fallback model answered is recorded under that model.
      recordRun(database.db, run(randomUUID(), "claude-opus-4-8", { input_tokens: 300 }));
      // A run where no call came back: no model, no tokens.
      recordRun(database.db, run(randomUUID(), null, {}));
      const byModel = tokensByModel(database.db).sort((a, b) => String(a.model).localeCompare(String(b.model)));
      expect(byModel).toEqual([
        { model: "claude-opus-4-8", usage: { ...NO_TOKENS, input_tokens: 300 } },
        { model: "claude-opus-5-5", usage: { input_tokens: 2100, output_tokens: 510, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } },
        { model: null, usage: NO_TOKENS },
      ]);
    } finally {
      database.close();
    }
  });

  it("is empty for someone who hasn't used the coach yet", () => {
    const database = openTestDb();
    try {
      expect(tokensByModel(database.db)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("spendByPerson", () => {
  it("prices each open person's usage record, each model at its own price, and names them by short id and role", () => {
    const { people, stores } = testPeople("owner@example.com", FRIEND);
    const [owner, friend] = stores;
    try {
      recordRun(owner!.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 1_000_000 })); // $4
      recordRun(owner!.db, run("insights:2026-09-28", "claude-opus-5-5", { output_tokens: 100_000 })); // $2
      recordRun(owner!.db, run(randomUUID(), "claude-opus-4-8", { input_tokens: 200_000 })); // $1 at Opus 4.8's $5
      recordRun(friend!.db, run(randomUUID(), "claude-opus-5-5", { cache_read_input_tokens: 1_000_000 })); // $0.20
      const { report, unpriced, failed } = collect();
      expect(rows(spendByPerson(people, OWNER_KEY, report))).toEqual([
        { ...OWNER, dollars: 7 },
        { ...GUEST, dollars: 0.2 },
      ]);
      expect(unpriced).toEqual([]);
      expect(failed).toEqual([]);
    } finally {
      people.close();
    }
  });

  it("leaves out a model with no price and says which, and ignores runs where no call came back", () => {
    const { people, stores } = testPeople("owner@example.com");
    try {
      recordRun(stores[0]!.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 500_000 })); // $2
      recordRun(stores[0]!.db, run(randomUUID(), "claude-unknown-1", { input_tokens: 999_999 }));
      recordRun(stores[0]!.db, run(randomUUID(), null, {}));
      const { report, unpriced } = collect();
      expect(rows(spendByPerson(people, OWNER_KEY, report))).toEqual([{ ...OWNER, dollars: 2 }]);
      expect(unpriced).toEqual(["claude-unknown-1"]);
    } finally {
      people.close();
    }
  });

  // One person's failing disk must not take everyone's spend, or the whole scrape, down with it.
  it("leaves out a person whose records can't be read, says who, and still reads everyone else", () => {
    const { people, stores } = testPeople("owner@example.com");
    try {
      recordRun(stores[0]!.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 250_000 })); // $1
      const withFailure = { opened: () => [stores[0]!, unreadable] } as unknown as People;
      const { report, failed } = collect();
      // Missing, never 0: a drop to 0 would read as a counter reset.
      expect(rows(spendByPerson(withFailure, OWNER_KEY, report))).toEqual([{ ...OWNER, dollars: 1 }]);
      expect(failed).toEqual([FRIEND_KEY]);
    } finally {
      people.close();
    }
  });

  // A scrape must never create a person's folder or open their database: startup opens everyone's.
  it("reads only the databases already open", () => {
    const { dataDir, people } = testPeople("owner@example.com");
    try {
      const strangerKey = personKey("stranger@example.com");
      preparePersonDir(dataDir, FRIEND_KEY);
      expect(rows(spendByPerson(people, OWNER_KEY, collect().report)).map(({ person }) => person)).toEqual([OWNER.person]);
      expect(people.opened().map((store) => store.key)).toEqual([OWNER_KEY]);
      expect(fs.existsSync(personPaths(dataDir, FRIEND_KEY).dbFile)).toBe(false);
      expect(fs.existsSync(personPaths(dataDir, strangerKey).dir)).toBe(false);
    } finally {
      people.close();
    }
  });
});

describe("spendReader", () => {
  it("logs an unpriced model and an unreadable person once each, by model and short id, however often it runs", () => {
    const { people, stores } = testPeople("owner@example.com");
    try {
      recordRun(stores[0]!.db, run(randomUUID(), "claude-unknown-1", { input_tokens: 10 }));
      const logged: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
      const log = {
        warn: (obj: Record<string, unknown>, msg: string) => logged.push({ level: "warn", obj, msg }),
        error: (obj: Record<string, unknown>, msg: string) => logged.push({ level: "error", obj, msg }),
      } as unknown as FastifyBaseLogger;
      const read = spendReader({ opened: () => [stores[0]!, unreadable] } as unknown as People, OWNER_KEY, log);
      read();
      read();
      read();
      expect(logged.map(({ level, obj }) => ({ level, model: obj.model, person: obj.person }))).toEqual([
        { level: "warn", model: "claude-unknown-1", person: undefined },
        { level: "error", model: undefined, person: GUEST.person },
      ]);
      expect(JSON.stringify(logged.map(({ obj, msg }) => ({ ...obj, err: undefined, msg })))).not.toMatch(/[0-9a-f]{64}|@/);
    } finally {
      people.close();
    }
  });
});

describe("the spend metric", () => {
  it("exposes each person's spend so far as a counter, read again on every scrape", async () => {
    const metrics = createMetrics();
    let current = [{ person: { key: OWNER_KEY, owner: true }, dollars: 1.5 }, { person: { key: FRIEND_KEY, owner: false }, dollars: 0 }];
    registerSpend(metrics, () => current);
    let text = await metrics.registry.metrics();
    expect(text).toContain("# TYPE fitnessai_ai_cost_dollars_total counter");
    expect(spendSeries(text)).toEqual([
      'fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 1.5',
      'fitnessai_ai_cost_dollars_total{person="f387373a",role="guest"} 0',
    ]);
    current = [{ person: { key: OWNER_KEY, owner: true }, dollars: 2.25 }];
    text = await metrics.registry.metrics();
    // The new total, and no stale series for someone the read no longer returns.
    expect(spendSeries(text)).toEqual(['fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 2.25']);
  });

  it("shows a person's newly recorded runs, priced, on the next scrape, naming them only by short id", async () => {
    const metrics = createMetrics();
    const { people, stores } = testPeople("owner@example.com", FRIEND);
    try {
      registerSpend(metrics, () => spendByPerson(people, OWNER_KEY, collect().report));
      recordRun(stores[0]!.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 250_000 })); // $1
      expect(spendSeries(await metrics.registry.metrics())).toEqual([
        'fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 1',
        'fitnessai_ai_cost_dollars_total{person="f387373a",role="guest"} 0',
      ]);
      recordRun(stores[0]!.db, run("insights:2026-09-28", "claude-opus-5-5", { output_tokens: 50_000 })); // $1
      const text = await metrics.registry.metrics();
      expect(spendSeries(text)[0]).toBe('fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 2');
      expect(text).not.toContain("@");
      expect(text).not.toMatch(/[0-9a-f]{64}/);
    } finally {
      people.close();
    }
  });

  // The owner's choice (2026-10-08): the dashboard shows who is who.
  it("names a person on the invite list by email, and anyone else by short id", async () => {
    const metrics = createMetrics(new Map([[OWNER_KEY, "owner@example.com"]]));
    registerSpend(metrics, () => [{ person: { key: OWNER_KEY, owner: true }, dollars: 1.5 }, { person: { key: FRIEND_KEY, owner: false }, dollars: 0.25 }]);
    expect(spendSeries(await metrics.registry.metrics())).toEqual([
      'fitnessai_ai_cost_dollars_total{person="f387373a",role="guest"} 0.25',
      'fitnessai_ai_cost_dollars_total{person="owner@example.com",role="owner"} 1.5',
    ]);
  });

  it("still serves every other metric when one person's records can't be read", async () => {
    const metrics = createMetrics();
    const { people, stores } = testPeople("owner@example.com");
    try {
      const withFailure = { opened: () => [stores[0]!, unreadable] } as unknown as People;
      registerSpend(metrics, () => spendByPerson(withFailure, OWNER_KEY, collect().report));
      const text = await metrics.registry.metrics();
      expect(text).toContain("# TYPE fitnessai_http_requests_total counter");
      expect(spendSeries(text)).toEqual(['fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 0']);
    } finally {
      people.close();
    }
  });
});
