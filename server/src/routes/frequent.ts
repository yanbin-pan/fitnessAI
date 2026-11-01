import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import { starterFor } from "../days/featured.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { exerciseData, foodData } from "../log/convert.ts";
import { getEntry, insertEntry } from "../log/entries.ts";
import { getProfile } from "../profile/profile.ts";
import { deleteFrequent, frequentView, getFrequent, saveFrequent } from "../regulars/frequent.ts";
import { FREQUENT_KEY_PREFIX, analyseRegulars } from "../regulars/regulars.ts";
import { FrequentInput, RegularLogInput, slotOf } from "../shared.ts";
import type { EntryResult, FrequentItem, FrequentView } from "../shared.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

// Frequent items (2026-11-01): pinned, edited and unpinned by the person, and logged with a tap. No coach, no tokens.

const ID = /^[0-9a-f-]{36}$/;

export function registerFrequentRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/frequent", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    return frequentView(deps.db, todayIn(profile.timezone, deps.now()), profile.timezone) satisfies FrequentView;
  });

  // Makes or replaces one, under an id made on the phone: the edit sheet saves as you go, and a repeat is harmless.
  app.put<{ Params: { id: string } }>("/api/frequent/:id", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    if (!ID.test(req.params.id)) return reply.code(404).send({ error: "not_found" });
    const input = parseBody(FrequentInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    saveFrequent(deps.db, req.params.id, input, now.toISOString());
    return getFrequent(deps.db, todayIn(profile.timezone, now), profile.timezone, req.params.id) satisfies FrequentItem | undefined;
  });

  // Pins a regular found in the log, as it is now, around the part of the day it is usually had. The body's id is the
  // new item's, made on the phone, so pinning twice after a lost reply makes one item.
  app.post<{ Params: { key: string } }>("/api/regulars/:key/pin", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(RegularLogInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const today = todayIn(profile.timezone, now);
    const existing = getFrequent(deps.db, today, profile.timezone, input.id);
    if (existing) return existing;
    const regular = analyseRegulars(deps.db, today, profile.timezone).regulars.find((r) => r.key === req.params.key);
    if (!regular) return reply.code(404).send({ error: "not_found" });
    saveFrequent(deps.db, input.id, {
      name: regular.name, foods: regular.foods, exercises: regular.exercises, slot: slotOf(regular.typical_time), source_key: regular.key,
    }, now.toISOString());
    reply.code(201);
    return getFrequent(deps.db, today, profile.timezone, input.id) satisfies FrequentItem | undefined;
  });

  app.delete<{ Params: { id: string } }>("/api/frequent/:id", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    // Already gone is as good as removed: a repeated delete after a lost reply must not fail.
    deleteFrequent(deps.db, req.params.id);
    return reply.code(204).send();
  });

  // Logs one to today, at now. As with regulars, the entry id is made on the phone: a repeated tap logs it once.
  app.post<{ Params: { id: string } }>("/api/frequent/:id/log", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(RegularLogInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    if (!getEntry(deps.db, input.id)) {
      const item = getFrequent(deps.db, today, profile.timezone, req.params.id);
      if (!item || item.foods.length + item.exercises.length === 0) return reply.code(404).send({ error: "not_found" });
      deps.db.transaction((tx) => {
        const day = ensureDay(tx, profile, today, nowIso);
        insertEntry(tx, {
          id: input.id,
          date: today,
          logged_at: nowIso,
          source: "regular",
          message_id: null,
          regular_key: `${FREQUENT_KEY_PREFIX}${item.id}`,
          foods: item.foods.map(foodData),
          exercises: item.exercises.map((x) => exerciseData(x, day.weight_kg_used)),
        }, nowIso);
      });
      reply.code(201);
    }
    const entry = getEntry(deps.db, input.id);
    if (!entry) throw new Error(`entry ${input.id} disappeared`);
    const result: EntryResult = { entry, day: buildDayView(deps.db, profile, entry.date, today, nowIso, starterFor(deps.person.owner)) };
    return result;
  });
}
