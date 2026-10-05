import { anthropicClient } from "./ai/anthropic.ts";
import { buildApp } from "./app.ts";
import { createVerifier, devVerifier } from "./auth/access.ts";
import { loadConfig } from "./config.ts";
import { moveOwnerIn } from "./db/location.ts";
import { startNightlySnapshot, startRetention } from "./jobs.ts";
import { createMetrics, serveMetrics } from "./metrics.ts";
import { createPeople, personKey } from "./people/people.ts";
import { getProfile } from "./profile/profile.ts";

const config = loadConfig(process.env);
// The development sign-in bypass must never be reachable from the network.
const host = config.devAuthEmail ? "127.0.0.1" : "0.0.0.0";
const ownerKey = personKey(config.ownerEmail);
// Before anything opens a database: milestone 2.1's one folder becomes the owner's (2.2 §4).
const move = moveOwnerIn(config.dataDir, ownerKey);
const people = createPeople({ dataDir: config.dataDir });
// Everyone's database opens now, as the one database did before: a lock left by the previous pod is waited out here,
// at startup, never inside a request. A database with a migration to run is snapshotted first.
for (const key of people.keys()) people.store(key);
const owner = people.store(ownerKey);

// loadConfig guarantees Access settings whenever the development bypass is off.
const verifier = config.devAuthEmail ? devVerifier(config.devAuthEmail) : createVerifier(config.access!);
const ai = config.anthropic.apiKey
  ? anthropicClient({ apiKey: config.anthropic.apiKey, model: config.anthropic.model, effort: config.anthropic.effort })
  : null;
const metrics = createMetrics();
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
if (move === "moved") app.log.info("moved the owner's data into users/ (milestone 2.2)");
if (move === "both") app.log.warn("found data in both data/db and the owner's folder under data/users; using the owner's folder. Check the old data/db, data/photos and data/snapshots aren't needed, then remove them");

const job = startNightlySnapshot({ people, keep: config.snapshotKeep, timeZone: getProfile(owner.db)?.timezone ?? "Europe/London", log: app.log });
const retention = startRetention({ people, hours: config.retentionHours, log: app.log });
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
  metricsServer.close();
  await app.close();
  people.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
