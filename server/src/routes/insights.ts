import type { FastifyInstance } from "fastify";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { ensureWeeklyInsight, insightsView } from "../insights/insights.ts";
import { getProfile } from "../profile/profile.ts";

export function registerInsightRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  // The Insights tab (2026-10-06 design §3.4). When this week's analysis is due it starts here, in the background, and
  // the tab asks again until it is ready; the hourly job writes it too, for anyone who doesn't open the tab.
  app.get("/api/insights", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const dailyCallCap = deps.person.owner ? deps.callCaps.owner : deps.callCaps.guest;
    return insightsView({ sql: deps.db, profile, ai: deps.ai, now: deps.now(), dailyCallCap }, (insightDeps) => {
      ensureWeeklyInsight(insightDeps).catch((err: unknown) => req.log.error({ err }, "weekly insight failed"));
    });
  });
}
