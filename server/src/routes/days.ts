import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile } from "../profile/profile.ts";
import { isIsoDate } from "../shared.ts";
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
}
