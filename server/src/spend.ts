import type { FastifyBaseLogger } from "fastify";
import { costDollars } from "./ai/pricing.ts";
import { tokensByModel } from "./coach/usage.ts";
import { personLabels } from "./metrics.ts";
import type { Spend } from "./metrics.ts";
import { shortKey } from "./people/people.ts";
import type { People } from "./people/people.ts";

/** What reading everyone's spend reports along the way. */
export interface SpendReport {
  /** A model with no list price: its tokens are left out of the sum. */
  unpriced(model: string): void;
  /** A person whose usage records could not be read: they are left out of this read. */
  failed(key: string, err: unknown): void;
}

/**
 * Each person's estimated Anthropic spend so far: every call their usage records hold, the coach's runs and the weekly
 * insights' alike, at list prices. Only the databases already open are read, so a scrape never creates a person's
 * folder or opens their database. One person's records failing to read leaves out only that person.
 */
export function spendByPerson(people: People, ownerKey: string, report: SpendReport): Spend[] {
  const spend: Spend[] = [];
  for (const store of people.opened()) {
    let records: ReturnType<typeof tokensByModel>;
    try {
      records = tokensByModel(store.db);
    } catch (err) {
      // Left out, never shown as 0: a drop to 0 would read as a counter reset, and increase() would then count the
      // person's whole total as spent. The next scrape tries again.
      report.failed(store.key, err);
      continue;
    }
    let dollars = 0;
    for (const { model, usage } of records) {
      // No call came back on these runs, so they carry no tokens.
      if (model === null) continue;
      const cost = costDollars(model, usage);
      if (cost === null) report.unpriced(model);
      else dollars += cost;
    }
    spend.push({ labels: personLabels({ key: store.key, owner: store.key === ownerKey }), dollars });
  }
  return spend;
}

/** The read the metric runs on every scrape: an unpriced model, or a person whose records won't read, is logged once. */
export function spendReader(people: People, ownerKey: string, log: FastifyBaseLogger): () => Spend[] {
  const unpriced = new Set<string>();
  const failed = new Set<string>();
  return () =>
    spendByPerson(people, ownerKey, {
      unpriced(model) {
        if (unpriced.has(model)) return;
        unpriced.add(model);
        log.warn({ model }, "no list price for this model, so the spend estimate leaves its calls out; add it to src/ai/pricing.ts");
      },
      failed(key, err) {
        if (failed.has(key)) return;
        failed.add(key);
        log.error({ err, person: shortKey(key) }, "a person's usage records could not be read, so the spend estimate leaves them out");
      },
    });
}
