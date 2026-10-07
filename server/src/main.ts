import { anthropicClient } from "./ai/anthropic.ts";
import { buildApp } from "./app.ts";
import { createVerifier, devVerifier } from "./auth/access.ts";
import { loadConfig } from "./config.ts";
import { moveOwnerIn } from "./db/location.ts";
import { startInsights, startNightlySnapshot, startRetention } from "./jobs.ts";
import { createMetrics, registerSpend, seedPeople, serveMetrics } from "./metrics.ts";
import { createPeople, personKey, shortKey } from "./people/people.ts";
import { getProfile } from "./profile/profile.ts";
import { spendByPerson } from "./spend.ts";

const config = loadConfig(process.env);
// The development sign-in bypass must never be reachable from the network.
const host = config.devAuthEmail ? "127.0.0.1" : "0.0.0.0";
const ownerKey = personKey(config.ownerEmail);
// Before anything opens a database: milestone 2.1's one folder becomes the owner's (2.2 §4).
const move = moveOwnerIn(config.dataDir, ownerKey);
const people = createPeople({ dataDir: config.dataDir });
// The owner's database opens first, and nothing guards it: without it there is nothing to serve, so a failure stops the
// start, loudly, as it always did. A lock left by the previous pod is waited out here, at startup, never inside a request (P2).
const owner = people.store(ownerKey);

// loadConfig guarantees Access settings whenever the development bypass is off.
const verifier = config.devAuthEmail ? devVerifier(config.devAuthEmail) : createVerifier(config.access!);
const ai = config.anthropic.apiKey
  ? anthropicClient({ apiKey: config.anthropic.apiKey, model: config.anthropic.model, effort: config.anthropic.effort })
  : null;
const metrics = createMetrics();
// So a restart doesn't hide anyone's first request or message from increase() and rate(). The people on the list, not the folders
// under users/: those still include guests who were taken off it.
seedPeople(metrics, [
  { key: ownerKey, owner: true },
  ...(config.access?.allowedEmails ?? []).map((email) => ({ key: personKey(email), owner: false })),
]);
const app = buildApp({
  people,
  verifier,
  ai,
  now: () => new Date(),
  webDist: config.webDist,
  coachBudgetMs: config.coachBudgetMs,
  callCaps: { owner: config.aiDailyCallCap, guest: config.guestDailyCallCap },
  metrics,
  logger: true,
});
// Each person's spend so far, priced from their usage records whenever Prometheus scrapes. A model with no list price
// is named in the log once, not on every scrape.
const unpriced = new Set<string>();
registerSpend(metrics, () =>
  spendByPerson(people, ownerKey, (model) => {
    if (unpriced.has(model)) return;
    unpriced.add(model);
    app.log.warn({ model }, "no list price for this model, so the spend estimate leaves its calls out; add it to src/ai/pricing.ts");
  }),
);
if (move === "moved") app.log.info("moved the owner's data into users/ (milestone 2.2)");
if (move === "both") app.log.warn("found data in both data/db and the owner's folder under data/users; using the owner's folder. Check the old data/db, data/photos and data/snapshots aren't needed, then remove them");

// Everyone else's database opens now too, before the app listens (P2), and only now that the log and its serializer
// exist. A database with a migration to run is snapshotted first. One that won't open is logged by the start of its
// key and the rest go on: it must not take the app down for everyone else.
for (const key of people.keys()) {
  if (key === ownerKey) continue;
  try {
    people.store(key);
  } catch (err) {
    app.log.error({ err, person: shortKey(key) }, "a person's database could not be opened");
  }
}
// From here a locked database is refused at once instead of blocking the event loop for up to 2 minutes.
people.stopWaitingForLocks();

const job = startNightlySnapshot({ people, keep: config.snapshotKeep, timeZone: getProfile(owner.db)?.timezone ?? "Europe/London", log: app.log });
const retention = startRetention({ people, log: app.log });
const insightsJob = startInsights({
  people, ai, ownerKey, callCaps: { owner: config.aiDailyCallCap, guest: config.guestDailyCallCap }, log: app.log,
});
const metricsServer = await serveMetrics(metrics, config.metricsPort, host);
await app.listen({ host, port: config.port });
if (!ai) app.log.warn("ANTHROPIC_API_KEY is not set: the coach is off; manual logging still works");

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  job.stop();
  retention.stop();
  insightsJob.stop();
  metricsServer.close();
  await app.close();
  people.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
