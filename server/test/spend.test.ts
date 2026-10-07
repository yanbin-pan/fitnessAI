import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { AiUsage } from "../src/ai/client.ts";
import { PRICES, costDollars } from "../src/ai/pricing.ts";
import { recordRun, tokensByModel } from "../src/coach/usage.ts";
import { preparePersonDir } from "../src/db/location.ts";
import { createMetrics, registerSpend } from "../src/metrics.ts";
import { personKey } from "../src/people/people.ts";
import { spendByPerson } from "../src/spend.ts";
import { NOW, openTestDb, testPeople } from "./helpers.ts";

const OWNER_KEY = personKey("owner@example.com");
const FRIEND = "friend@example.com";
// How metrics name a person: the first 8 hex characters of sha256(email) (2.2 §8), and owner or guest.
const OWNER = { person: "c8cd3c64", role: "owner" } as const;
const GUEST = { person: "f387373a", role: "guest" } as const;
const NO_TOKENS: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** One recorded run, as the coach or the weekly insights write it. */
const run = (messageId: string, model: string | null, usage: Partial<AiUsage>) => ({
  messageId, date: "2026-10-03", model, calls: 1, usage: { ...NO_TOKENS, ...usage }, nowIso: NOW.toISOString(),
});
/** Dollars to the micro-dollar, so float noise doesn't decide a comparison. */
const cents = (dollars: number) => Math.round(dollars * 1e6) / 1e6;
/** The spend metric's series as exposed (`name{labels} value`), sorted. */
const spendSeries = (text: string) => text.split("\n").filter((line) => line.startsWith("fitnessai_ai_cost_dollars_total{")).sort();

describe("costDollars", () => {
  it("prices each kind of token at the model's list price per million", () => {
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, input_tokens: 1_000_000 })).toBeCloseTo(4);
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, output_tokens: 1_000_000 })).toBeCloseTo(20);
    // Claude Opus 5.5 reads the cache at 0.05x input, and the app writes it at the 5-minute rate, 1.25x.
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costDollars("claude-opus-5-5", { ...NO_TOKENS, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5);
    // A coach run: 3,000 new input tokens, 40,000 read from the cache, 2,000 written to it, 800 out.
    const usage = { input_tokens: 3000, output_tokens: 800, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2000 };
    expect(costDollars("claude-opus-5-5", usage)).toBeCloseTo(0.012 + 0.016 + 0.008 + 0.01, 9);
  });

  it("has no price for a model missing from the table", () => {
    expect(costDollars("claude-unknown-1", { ...NO_TOKENS, input_tokens: 10 })).toBeNull();
  });

  // Switching the model without adding its price would quietly leave every call out of the dashboard's estimate.
  it("has a price for the model the cluster runs", () => {
    const manifest = fs.readFileSync(new URL("../../k8s/30-app.yaml", import.meta.url), "utf8");
    const model = /name: ANTHROPIC_MODEL\s+value: "?([\w.-]+)"?/.exec(manifest)?.[1];
    expect(model).toBeDefined();
    expect(PRICES[model!], `add ${model}'s list price to server/src/ai/pricing.ts`).toBeDefined();
  });
});

describe("tokensByModel", () => {
  it("adds up every recorded run per model, the coach's and the weekly insights' alike", () => {
    const database = openTestDb();
    try {
      recordRun(database.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 }));
      recordRun(database.db, run("insights:2026-09-28", "claude-opus-5-5", { input_tokens: 2000, output_tokens: 500 }));
      // A run where no call came back: no model, no tokens.
      recordRun(database.db, run(randomUUID(), null, {}));
      const byModel = tokensByModel(database.db).sort((a, b) => String(a.model).localeCompare(String(b.model)));
      expect(byModel).toEqual([
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
  it("prices each open person's usage record and names them by short id and role", () => {
    const { people, stores } = testPeople("owner@example.com", FRIEND);
    const [owner, friend] = stores;
    try {
      recordRun(owner!.db, run(randomUUID(), "claude-opus-5-5", { input_tokens: 1_000_000 })); // $4
      recordRun(owner!.db, run("insights:2026-09-28", "claude-opus-5-5", { output_tokens: 100_000 })); // $2
      recordRun(friend!.db, run(randomUUID(), "claude-opus-5-5", { cache_read_input_tokens: 1_000_000 })); // $0.20
      const unpriced: string[] = [];
      const spend = spendByPerson(people, OWNER_KEY, (model) => unpriced.push(model));
      expect(spend.map(({ labels, dollars }) => ({ ...labels, dollars: cents(dollars) })).sort((a, b) => a.person.localeCompare(b.person))).toEqual([
        { ...OWNER, dollars: 6 },
        { ...GUEST, dollars: 0.2 },
      ]);
      expect(unpriced).toEqual([]);
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
      const unpriced: string[] = [];
      const spend = spendByPerson(people, OWNER_KEY, (model) => unpriced.push(model));
      expect(spend.map(({ labels, dollars }) => ({ ...labels, dollars: cents(dollars) }))).toEqual([{ ...OWNER, dollars: 2 }]);
      expect(unpriced).toEqual(["claude-unknown-1"]);
    } finally {
      people.close();
    }
  });

  // A scrape must never create a person's folder or open their database: startup opens everyone's.
  it("reads only the databases already open", () => {
    const { dataDir, people } = testPeople("owner@example.com");
    try {
      preparePersonDir(dataDir, personKey(FRIEND));
      expect(spendByPerson(people, OWNER_KEY, () => {}).map(({ labels }) => labels)).toEqual([OWNER]);
      expect(people.opened().map((store) => store.key)).toEqual([OWNER_KEY]);
    } finally {
      people.close();
    }
  });
});

describe("the spend metric", () => {
  it("exposes each person's spend so far as a counter, read again on every scrape", async () => {
    const metrics = createMetrics();
    let ownerDollars = 1.5;
    let people = [{ labels: OWNER, dollars: ownerDollars }, { labels: GUEST, dollars: 0 }];
    registerSpend(metrics, () => people.map((row) => (row.labels === OWNER ? { ...row, dollars: ownerDollars } : row)));
    let text = await metrics.registry.metrics();
    expect(text).toContain("# TYPE fitnessai_ai_cost_dollars_total counter");
    expect(spendSeries(text)).toEqual([
      'fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 1.5',
      'fitnessai_ai_cost_dollars_total{person="f387373a",role="guest"} 0',
    ]);
    ownerDollars = 2.25;
    people = people.slice(0, 1);
    text = await metrics.registry.metrics();
    // The new total, and no stale series for someone the read no longer returns.
    expect(spendSeries(text)).toEqual(['fitnessai_ai_cost_dollars_total{person="c8cd3c64",role="owner"} 2.25']);
  });

  it("shows a person's newly recorded runs, priced, on the next scrape, naming them only by short id", async () => {
    const metrics = createMetrics();
    const { people, stores } = testPeople("owner@example.com", FRIEND);
    try {
      registerSpend(metrics, () => spendByPerson(people, OWNER_KEY, () => {}));
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
});
