import type { FastifyInstance } from "fastify";
import { refreshDay } from "../days/days.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { companionChangedAt, companionLockedUntil, getProfile, saveProfile, setCompanionChangedAt } from "../profile/profile.ts";
import { DEFAULT_COMPANION, ProfileInput } from "../shared.ts";
import type { Profile, ProfileView } from "../shared.ts";
import { baselineTargets } from "../targets/targets.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

function profileView(profile: Profile, changedAt: string | null, now: Date): ProfileView {
  const today = todayIn(profile.timezone, now);
  return {
    profile,
    calculated: baselineTargets(profile, profile.weight_kg, today, false),
    companion_locked_until: companionLockedUntil(changedAt, today),
  };
}

export function registerProfileRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/profile", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(404).send({ error: "no_profile" });
    return profileView(profile, companionChangedAt(deps.db), deps.now());
  });

  app.put("/api/profile", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = parseBody(ProfileInput, req.body, reply);
    if (!profile) return reply;
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    // The companion changes at most once every 3 months (2026-10-08 companions design §7). Staying on Zabaione, the
    // default, is no choice yet: the first pick is always free.
    const stored = getProfile(deps.db);
    const changing = stored ? stored.companion !== profile.companion : profile.companion !== DEFAULT_COMPANION;
    if (stored && changing) {
      const until = companionLockedUntil(companionChangedAt(deps.db), today);
      if (until) return reply.code(409).send({ error: "companion_locked", until });
    }
    // Today's targets follow the new profile; past days keep their snapshot (spec §7.5).
    deps.db.transaction((tx) => {
      saveProfile(tx, profile, nowIso);
      if (changing) setCompanionChangedAt(tx, today);
      refreshDay(tx, profile, today, nowIso);
    });
    return profileView(profile, companionChangedAt(deps.db), now);
  });
}
