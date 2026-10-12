import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import { starterFor } from "../days/featured.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps, RequestDeps } from "../deps.ts";
import { exerciseData, foodData } from "../log/convert.ts";
import { deleteEntry, getEntry, insertEntry, itemsOf, replaceEntryItems } from "../log/entries.ts";
import { getProfile } from "../profile/profile.ts";
import { EntryCopyInput, EntryPatch, MAX_BACKDATE_DAYS, ManualEntryInput, daysBetween } from "../shared.ts";
import type { DeleteResult, Entry, EntriesResult, EntryResult, Profile } from "../shared.ts";
import { localTime, todayIn, zonedTimeToInstant } from "../time.ts";
import { parseBody } from "./http.ts";

function entryResult(deps: RequestDeps, profile: Profile, id: string, now: Date): EntryResult {
  const entry = getEntry(deps.db, id);
  if (!entry) throw new Error(`entry ${id} disappeared`);
  return { entry, day: buildDayView(deps.db, profile, entry.date, todayIn(profile.timezone, now), now.toISOString(), starterFor(deps.person.owner)) };
}

export function registerEntryRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.post("/api/entries", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(ManualEntryInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);

    // The id is made on the phone, so sending the same entry twice is harmless:
    // a repeat gets the stored entry, even after its date has left the window.
    if (!getEntry(deps.db, input.id)) {
      if (input.date > today) return reply.code(400).send({ error: "future_date" });
      if (daysBetween(input.date, today) > MAX_BACKDATE_DAYS) return reply.code(400).send({ error: "too_old" });
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

  // Pastes copies of logged entries onto a day: the same items with the same nutrition, and no coach (so no tokens).
  // A copy keeps the time of day of the entry it came from, except that one pasted onto today is never later than now.
  app.post("/api/entries/copy", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(EntryCopyInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);

    // As with a manual entry, a copy already stored is answered with what was stored, whatever the date now.
    const missing = input.copies.filter((copy) => !getEntry(deps.db, copy.id));
    if (missing.length > 0) {
      if (input.date > today) return reply.code(400).send({ error: "future_date" });
      if (daysBetween(input.date, today) > MAX_BACKDATE_DAYS) return reply.code(400).send({ error: "too_old" });
      const pastes: { id: string; source: Entry }[] = [];
      for (const copy of missing) {
        const source = getEntry(deps.db, copy.from);
        // Deleted since it was copied: nothing is pasted, so the phone can say so and forget the copy.
        if (!source) return reply.code(404).send({ error: "not_found" });
        pastes.push({ id: copy.id, source });
      }
      deps.db.transaction((tx) => {
        ensureDay(tx, profile, input.date, nowIso);
        for (const { id, source } of pastes) {
          const at = zonedTimeToInstant(input.date, localTime(new Date(source.logged_at), profile.timezone), profile.timezone);
          insertEntry(tx, {
            id,
            date: input.date,
            logged_at: (input.date === today && at > now ? now : at).toISOString(),
            source: "manual",
            message_id: null,
            ...itemsOf(source),
          }, nowIso);
        }
      });
      reply.code(201);
    }
    const result: EntriesResult = {
      entries: input.copies.map((copy) => {
        const entry = getEntry(deps.db, copy.id);
        if (!entry) throw new Error(`entry ${copy.id} disappeared`);
        return entry;
      }),
      day: buildDayView(deps.db, profile, input.date, today, nowIso, starterFor(deps.person.owner)),
    };
    return result;
  });

  app.patch<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const deps = forRequest(appDeps, req);
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
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const existing = getEntry(deps.db, req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    deleteEntry(deps.db, existing.id);
    const now = deps.now();
    const result: DeleteResult = {
      day: buildDayView(deps.db, profile, existing.date, todayIn(profile.timezone, now), now.toISOString(), starterFor(deps.person.owner)),
    };
    return result;
  });
}
