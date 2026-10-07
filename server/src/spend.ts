import { costDollars } from "./ai/pricing.ts";
import { tokensByModel } from "./coach/usage.ts";
import { personLabels } from "./metrics.ts";
import type { Spend } from "./metrics.ts";
import type { People } from "./people/people.ts";

/**
 * Each person's estimated Anthropic spend so far: everything their usage records hold, the coach's runs and the weekly
 * insights' alike, at list prices. Only the databases already open are read, so a scrape never creates a person's
 * folder or opens their database. A model with no list price goes to onUnpriced and is left out of the sum.
 */
export function spendByPerson(people: People, ownerKey: string, onUnpriced: (model: string) => void): Spend[] {
  return people.opened().map((store) => {
    let dollars = 0;
    for (const { model, usage } of tokensByModel(store.db)) {
      // No call came back on these runs, so they carry no tokens.
      if (model === null) continue;
      const cost = costDollars(model, usage);
      if (cost === null) onUnpriced(model);
      else dollars += cost;
    }
    return { labels: personLabels({ key: store.key, owner: store.key === ownerKey }), dollars };
  });
}
