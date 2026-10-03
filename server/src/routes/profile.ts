import type { FastifyInstance } from "fastify";
import { refreshDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile, saveProfile } from "../profile/profile.ts";
import { ProfileInput } from "../shared.ts";
import type { Profile, ProfileView } from "../shared.ts";
import { baselineTargets } from "../targets/targets.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

function profileView(profile: Profile, now: Date): ProfileView {
  return { profile, calculated: baselineTargets(profile, profile.weight_kg, todayIn(profile.timezone, now), false) };
}

export function registerProfileRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/profile", async (_req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(404).send({ error: "no_profile" });
    return profileView(profile, deps.now());
  });

  app.put("/api/profile", async (req, reply) => {
    const profile = parseBody(ProfileInput, req.body, reply);
    if (!profile) return reply;
    const now = deps.now();
    const nowIso = now.toISOString();
    // Today's targets follow the new profile; past days keep their snapshot (spec §7.5).
    deps.db.transaction((tx) => {
      saveProfile(tx, profile, nowIso);
      refreshDay(tx, profile, todayIn(profile.timezone, now), nowIso);
    });
    return profileView(profile, now);
  });
}
