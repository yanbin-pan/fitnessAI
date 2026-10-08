import type { FastifyInstance } from "fastify";
import { recordInteraction } from "../companion/interactions.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile } from "../profile/profile.ts";
import { CompanionInteractionInput } from "../shared.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

// Interactions with the companion (2026-10-08 companions design §8): the phone reports each pet and each open of the
// bubble, and the owner's dashboard counts them per person per month.

export function registerCompanionRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.post("/api/companion/interactions", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(CompanionInteractionInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    recordInteraction(deps.db, todayIn(profile.timezone, deps.now()), input.kind);
    return reply.code(204).send();
  });
}
