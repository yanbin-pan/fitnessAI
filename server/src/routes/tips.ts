import type { FastifyInstance } from "fastify";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile } from "../profile/profile.ts";
import { MAX_TIPS_PER_DAY, TipSeenInput } from "../shared.ts";
import type { TipsView } from "../shared.ts";
import { todayIn } from "../time.ts";
import { markTipSeen, seenTips } from "../tips/tips.ts";
import { parseBody } from "./http.ts";

// The companion's tips (2026-10-23 pet tips design): which have been shown, and a new one as the phone shows it.

export function registerTipRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/tips", async (req): Promise<TipsView> => {
    const deps = forRequest(appDeps, req);
    return { tips: seenTips(deps.db) };
  });

  app.post("/api/tips", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(TipSeenInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    if (!markTipSeen(deps.db, input, todayIn(profile.timezone, now), now.toISOString(), MAX_TIPS_PER_DAY)) {
      return reply.code(409).send({ error: "tip_limit" });
    }
    return { tips: seenTips(deps.db) } satisfies TipsView;
  });
}
