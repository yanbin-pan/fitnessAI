import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { exerciseData, foodData } from "../log/convert.ts";
import { deleteEntry, getEntry, insertEntry, replaceEntryItems } from "../log/entries.ts";
import { getProfile } from "../profile/profile.ts";
import { EntryPatch, MAX_BACKDATE_DAYS, ManualEntryInput, daysBetween } from "../shared.ts";
import type { DeleteResult, EntryResult, Profile } from "../shared.ts";
import { todayIn, zonedTimeToInstant } from "../time.ts";
import { parseBody } from "./http.ts";

function entryResult(deps: AppDeps, profile: Profile, id: string, now: Date): EntryResult {
  const entry = getEntry(deps.db, id);
  if (!entry) throw new Error(`entry ${id} disappeared`);
  return { entry, day: buildDayView(deps.db, profile, entry.date, todayIn(profile.timezone, now), now.toISOString()) };
}

export function registerEntryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/entries", async (req, reply) => {
    const input = parseBody(ManualEntryInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    if (input.date > today) return reply.code(400).send({ error: "future_date" });
    if (daysBetween(input.date, today) > MAX_BACKDATE_DAYS) return reply.code(400).send({ error: "too_old" });

    // The id is made on the phone, so sending the same entry twice is harmless.
    if (!getEntry(deps.db, input.id)) {
      const loggedAt =
        input.time !== null ? zonedTimeToInstant(input.date, input.time, profile.timezone)
        : input.date === today ? now
        : zonedTimeToInstant(input.date, "12:00", profile.timezone);
      deps.db.transaction((tx) => {
        const day = ensureDay(tx, profile, input.date, nowIso);
        insertEntry(tx, {
          id: input.id,
          date: input.date,
          logged_at: loggedAt.toISOString(),
          source: "manual",
          message_id: null,
          foods: input.foods.map(foodData),
          exercises: input.exercises.map((x) => exerciseData(x, day.weight_kg_used)),
        }, nowIso);
      });
      reply.code(201);
    }
    return entryResult(deps, profile, input.id, now);
  });

  app.patch<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const patch = parseBody(EntryPatch, req.body, reply);
    if (!patch) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const existing = getEntry(deps.db, req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const now = deps.now();
    const nowIso = now.toISOString();
    deps.db.transaction((tx) => {
      const day = ensureDay(tx, profile, existing.date, nowIso);
      replaceEntryItems(tx, existing.id, patch.foods.map(foodData), patch.exercises.map((x) => exerciseData(x, day.weight_kg_used)), nowIso);
    });
    return entryResult(deps, profile, existing.id, now);
  });

  app.delete<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const existing = getEntry(deps.db, req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    deleteEntry(deps.db, existing.id);
    const now = deps.now();
    const result: DeleteResult = {
      day: buildDayView(deps.db, profile, existing.date, todayIn(profile.timezone, now), now.toISOString()),
    };
    return result;
  });
}
