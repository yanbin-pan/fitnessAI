import type { FastifyBaseLogger } from "fastify";
import type { CompanionInteractionCounts } from "../metrics.ts";
import { shortKey } from "../people/people.ts";
import type { People } from "../people/people.ts";
import { getProfile } from "../profile/profile.ts";
import { addMonths } from "../shared.ts";
import { todayIn } from "../time.ts";
import { interactionCounts } from "./interactions.ts";

/**
 * Everyone's interactions with their companion, read again from their own records on every scrape: all-time counts, and
 * this calendar month and the one before in the person's timezone. Only the databases already open are read. One
 * person's records failing to read leaves out only that person, logged once.
 */
export function interactionsReader(people: People, ownerKey: string, now: () => Date, log: FastifyBaseLogger): () => CompanionInteractionCounts[] {
  const failed = new Set<string>();
  return () => {
    const out: CompanionInteractionCounts[] = [];
    for (const store of people.opened()) {
      try {
        // Someone who never set up has no timezone yet, and no companion either: their counts are zeros in UTC.
        const timeZone = getProfile(store.db)?.timezone ?? "UTC";
        const thisMonth = todayIn(timeZone, now()).slice(0, 7);
        const lastMonth = addMonths(`${thisMonth}-01`, -1).slice(0, 7);
        for (const { kind, total, byMonth } of interactionCounts(store.db, [lastMonth, thisMonth])) {
          const [last, current] = byMonth;
          out.push({ person: { key: store.key, owner: store.key === ownerKey }, kind, total, thisMonth: current.count, lastMonth: last.count });
        }
      } catch (err) {
        if (failed.has(store.key)) continue;
        failed.add(store.key);
        log.error({ err, person: shortKey(store.key) }, "a person's companion interactions could not be read, so the metric leaves them out");
      }
    }
    return out;
  };
}
