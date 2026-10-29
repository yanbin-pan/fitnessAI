import type { FastifyBaseLogger } from "fastify";
import type { EngagementRow } from "../metrics.ts";
import { shortKey } from "../people/people.ts";
import type { People } from "../people/people.ts";
import { getProfile } from "../profile/profile.ts";
import { todayIn } from "../time.ts";
import { actionsOf, engagementOf } from "./engagement.ts";

/**
 * Everyone's engagement, read again from their own records on every scrape, in their own timezone. Only the databases
 * already open are read. One person's records failing to read leaves out only that person, logged once.
 */
export function engagementReader(people: People, ownerKey: string, now: () => Date, log: FastifyBaseLogger): () => EngagementRow[] {
  const failed = new Set<string>();
  return () => {
    const out: EngagementRow[] = [];
    for (const store of people.opened()) {
      try {
        const profile = getProfile(store.db);
        const timeZone = profile?.timezone ?? "UTC";
        const engagement = engagementOf(actionsOf(store.db, timeZone), profile, todayIn(timeZone, now()));
        out.push({ person: { key: store.key, owner: store.key === ownerKey }, engagement });
      } catch (err) {
        if (failed.has(store.key)) continue;
        failed.add(store.key);
        log.error({ err, person: shortKey(store.key) }, "a person's engagement could not be read, so the metric leaves them out");
      }
    }
    return out;
  };
}
