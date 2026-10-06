import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import { starterFor } from "../days/featured.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { exerciseData, foodData } from "../log/convert.ts";
import { getEntry, insertEntry } from "../log/entries.ts";
import { getProfile } from "../profile/profile.ts";
import { analyseRegulars, dismissRegular, saveRegularEdit } from "../regulars/regulars.ts";
import { RegularEdit, RegularLogInput } from "../shared.ts";
import type { EntryResult, Regular, RegularsView } from "../shared.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

// Regulars (2026-10-06 design §2): listed, edited, removed and logged with a tap, never added by hand.

export function registerRegularRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/regulars", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const { minutesByKey: _minutes, ...view } = analyseRegulars(deps.db, todayIn(profile.timezone, deps.now()), profile.timezone);
    return view satisfies RegularsView;
  });

  app.put<{ Params: { key: string } }>("/api/regulars/:key", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const edit = parseBody(RegularEdit, req.body, reply);
    if (!edit) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const today = todayIn(profile.timezone, now);
    // Only a regular the analysis found can be edited: there is no adding one by hand.
    if (!analyseRegulars(deps.db, today, profile.timezone).regulars.some((r) => r.key === req.params.key)) {
      return reply.code(404).send({ error: "not_found" });
    }
    saveRegularEdit(deps.db, req.params.key, edit, now.toISOString());
    const updated = analyseRegulars(deps.db, today, profile.timezone).regulars.find((r) => r.key === req.params.key);
    return updated satisfies Regular | undefined;
  });

  app.delete<{ Params: { key: string } }>("/api/regulars/:key", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    if (!analyseRegulars(deps.db, todayIn(profile.timezone, now), profile.timezone).regulars.some((r) => r.key === req.params.key)) {
      return reply.code(404).send({ error: "not_found" });
    }
    dismissRegular(deps.db, req.params.key, now.toISOString());
    return reply.code(204).send();
  });

  // Logs a regular to today, at now. The id is made on the phone: a repeated tap gets the stored entry back.
  app.post<{ Params: { key: string } }>("/api/regulars/:key/log", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const input = parseBody(RegularLogInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    if (!getEntry(deps.db, input.id)) {
      const regular = analyseRegulars(deps.db, today, profile.timezone).regulars.find((r) => r.key === req.params.key);
      if (!regular) return reply.code(404).send({ error: "not_found" });
      deps.db.transaction((tx) => {
        const day = ensureDay(tx, profile, today, nowIso);
        insertEntry(tx, {
          id: input.id,
          date: today,
          logged_at: nowIso,
          source: "regular",
          message_id: null,
          regular_key: regular.key,
          foods: regular.foods.map(foodData),
          exercises: regular.exercises.map((x) => exerciseData(x, day.weight_kg_used)),
        }, nowIso);
      });
      reply.code(201);
    }
    const entry = getEntry(deps.db, input.id);
    if (!entry) throw new Error(`entry ${input.id} disappeared`);
    const result: EntryResult = {
      entry,
      day: buildDayView(deps.db, profile, entry.date, today, nowIso, starterFor(deps.person.owner)),
    };
    return result;
  });
}
