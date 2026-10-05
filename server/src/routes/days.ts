import type { FastifyInstance } from "fastify";
import { buildDayView, daySummaries, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile } from "../profile/profile.ts";
import { MAX_SUMMARY_DAYS, daysBetween, isIsoDate } from "../shared.ts";
import type { DaySummaries } from "../shared.ts";
import { todayIn } from "../time.ts";

export function registerDayRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { date: string } }>("/api/days/:date", async (req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    const date = req.params.date === "today" ? today : req.params.date;
    if (!isIsoDate(date)) return reply.code(400).send({ error: "invalid_date" });
    // Opening today creates its row, so a new day page simply exists (spec §7.5).
    if (date === today) ensureDay(deps.db, profile, date, nowIso);
    return buildDayView(deps.db, profile, date, today, nowIso);
  });

  // The calendar's month (spec §12). A repeated parameter arrives as an array, which counts as missing.
  app.get<{ Querystring: Record<string, unknown> }>("/api/days", async (req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!isIsoDate(from) || !isIsoDate(to) || to < from || daysBetween(from, to) + 1 > MAX_SUMMARY_DAYS) {
      return reply.code(400).send({ error: "bad_range" });
    }
    const summaries: DaySummaries = { goal: profile.goal, days: daySummaries(deps.db, profile, from, to, deps.now().toISOString()) };
    return summaries;
  });
}
