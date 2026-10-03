import path from "node:path";
import { anthropicClient } from "./ai/anthropic.ts";
import { buildApp } from "./app.ts";
import { createVerifier, devVerifier } from "./auth/access.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/open.ts";
import { startNightlySnapshot } from "./jobs.ts";
import { failInterrupted } from "./messages/messages.ts";
import { createMetrics, serveMetrics } from "./metrics.ts";
import { getProfile } from "./profile/profile.ts";

const config = loadConfig(process.env);
const snapshotDir = path.join(config.dataDir, "snapshots");
const database = openDatabase({ file: path.join(config.dataDir, "fitness.db"), snapshotDir });
failInterrupted(database.db);

// loadConfig guarantees Access settings whenever the development bypass is off.
const verifier = config.devAuthEmail ? devVerifier(config.devAuthEmail) : createVerifier(config.access!);
const ai = config.anthropic.apiKey
  ? anthropicClient({ apiKey: config.anthropic.apiKey, model: config.anthropic.model, effort: config.anthropic.effort })
  : null;
const metrics = createMetrics();
const app = buildApp({
  db: database.db,
  verifier,
  ai,
  now: () => new Date(),
  webDist: config.webDist,
  coachBudgetMs: config.coachBudgetMs,
  metrics,
  logger: true,
});

const job = startNightlySnapshot({
  sqlite: database.sqlite,
  dir: snapshotDir,
  keep: config.snapshotKeep,
  timeZone: getProfile(database.db)?.timezone ?? "Europe/London",
  log: app.log,
});
const metricsServer = await serveMetrics(metrics, config.metricsPort);
await app.listen({ host: "0.0.0.0", port: config.port });
if (!ai) app.log.warn("ANTHROPIC_API_KEY is not set: the coach is off; manual logging still works");

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  job.stop();
  metricsServer.close();
  await app.close();
  database.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
