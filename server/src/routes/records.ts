import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { callsOn, recordRun } from "../coach/usage.ts";
import { photos } from "../db/schema.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { LAB_READ_BUDGET_MS, readLabReport } from "../health/labread.ts";
import { PARSE_BUDGET_MS, parseHealthText } from "../health/parse.ts";
import {
  addCondition, addLabReport, addMedication, consentedAt, deleteHealthData, grantConsent, healthView, removeCondition, removeLabReport,
  removeMedication, updateMedication,
} from "../health/records.ts";
import { deletePhotoFiles, photoData } from "../photos/photos.ts";
import type { PhotoData } from "../photos/photos.ts";
import { getProfile } from "../profile/profile.ts";
import { ConditionInput, HealthParseInput, LANGUAGE_NAMES, LabReadInput, LabReportInput, MedicationInput } from "../shared.ts";
import type { HealthParseView, HealthView, LabReadView } from "../shared.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

// The Health tab (2026-10-12 health context design). Every write needs the person's consent first; deleting their
// health data takes the consent away with it.

export function registerRecordRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/records", async (req) => healthView(forRequest(appDeps, req).db) satisfies HealthView);

  app.post("/api/records/consent", async (req) => {
    const deps = forRequest(appDeps, req);
    grantConsent(deps.db, deps.now().toISOString());
    return healthView(deps.db) satisfies HealthView;
  });

  app.delete("/api/records", async (req, reply) => {
    deleteHealthData(forRequest(appDeps, req).db);
    return reply.code(204).send();
  });

  // Everything below is refused until the person has agreed.
  void app.register(async (records) => {
    records.addHook("preHandler", async (req, reply) => {
      if (!consentedAt(forRequest(appDeps, req).db)) return reply.code(409).send({ error: "no_consent" });
    });

    records.post("/api/records/conditions", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(ConditionInput, req.body, reply);
      if (!input) return reply;
      return reply.code(201).send(addCondition(deps.db, input, deps.now().toISOString()));
    });

    records.delete<{ Params: { id: string } }>("/api/records/conditions/:id", async (req, reply) => {
      const found = removeCondition(forRequest(appDeps, req).db, req.params.id);
      return found ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });

    records.post("/api/records/medications", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(MedicationInput, req.body, reply);
      if (!input) return reply;
      return reply.code(201).send(addMedication(deps.db, input, deps.now().toISOString()));
    });

    records.put<{ Params: { id: string } }>("/api/records/medications/:id", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(MedicationInput, req.body, reply);
      if (!input) return reply;
      const updated = updateMedication(deps.db, req.params.id, input, deps.now().toISOString());
      return updated ?? reply.code(404).send({ error: "not_found" });
    });

    records.delete<{ Params: { id: string } }>("/api/records/medications/:id", async (req, reply) => {
      const found = removeMedication(forRequest(appDeps, req).db, req.params.id);
      return found ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });

    records.post("/api/records/labs", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(LabReportInput, req.body, reply);
      if (!input) return reply;
      addLabReport(deps.db, input, deps.now().toISOString());
      return reply.code(201).send(healthView(deps.db) satisfies HealthView);
    });

    records.delete<{ Params: { id: string } }>("/api/records/labs/:id", async (req, reply) => {
      const found = removeLabReport(forRequest(appDeps, req).db, req.params.id);
      return found ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });

    // Reads photos of a report into rows for the person to check. Nothing is saved, and the photos are deleted whatever
    // the outcome: once read they have no further use (design §4).
    records.post("/api/records/labs/read", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(LabReadInput, req.body, reply);
      if (!input) return reply;
      const profile = getProfile(deps.db);
      if (!profile) return reply.code(409).send({ error: "no_profile" });
      // Only photos no message has claimed: a photo of the chat stays the chat's.
      const rows = deps.db.select().from(photos).where(inArray(photos.id, input.photo_ids)).all().filter((p) => p.message_id === null);
      if (rows.length !== input.photo_ids.length) return reply.code(404).send({ error: "photo_not_found" });
      const forget = () => {
        deps.db.delete(photos).where(inArray(photos.id, input.photo_ids)).run();
        deletePhotoFiles(deps.photoDir, rows);
      };
      const images = input.photo_ids.map((id) => photoData(deps.db, deps.photoDir, id)).filter((p): p is PhotoData => p !== null);
      if (images.length !== input.photo_ids.length) {
        forget();
        return reply.code(404).send({ error: "photo_not_found" });
      }
      const ai = deps.ai;
      if (!ai) {
        forget();
        return reply.code(503).send({ error: "ai_unavailable" });
      }
      const now = deps.now();
      const today = todayIn(profile.timezone, now);
      const cap = deps.person.owner ? deps.callCaps.owner : deps.callCaps.guest;
      if (callsOn(deps.db, today) >= cap) {
        forget();
        return reply.code(429).send({ error: "ai_cap" });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LAB_READ_BUDGET_MS);
      try {
        const outcome = await readLabReport(ai, images, LANGUAGE_NAMES[profile.language], controller.signal);
        // Counts against the daily cap like a coach message, a failed read too.
        recordRun(deps.db, { messageId: `labs:${input.photo_ids[0]}`, date: today, model: outcome.model, calls: 1, usage: outcome.usage, nowIso: deps.now().toISOString() });
        if (!outcome.ok) return reply.code(outcome.failure === "unreadable" ? 422 : 502).send({ error: `lab_${outcome.failure}` });
        return outcome.read satisfies LabReadView;
      } finally {
        clearTimeout(timer);
        forget();
      }
    });

    // A typed sentence into items to confirm. Nothing is saved here: each item the person keeps goes through the
    // routes above.
    records.post("/api/records/parse", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(HealthParseInput, req.body, reply);
      if (!input) return reply;
      const profile = getProfile(deps.db);
      if (!profile) return reply.code(409).send({ error: "no_profile" });
      const ai = deps.ai;
      if (!ai) return reply.code(503).send({ error: "ai_unavailable" });
      const today = todayIn(profile.timezone, deps.now());
      const cap = deps.person.owner ? deps.callCaps.owner : deps.callCaps.guest;
      if (callsOn(deps.db, today) >= cap) return reply.code(429).send({ error: "ai_cap" });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PARSE_BUDGET_MS);
      try {
        const outcome = await parseHealthText(ai, input.text, today, controller.signal);
        recordRun(deps.db, { messageId: `parse:${randomUUID()}`, date: today, model: outcome.model, calls: 1, usage: outcome.usage, nowIso: deps.now().toISOString() });
        if (!outcome.ok) return reply.code(502).send({ error: `parse_${outcome.failure}` });
        return outcome.parsed satisfies HealthParseView;
      } finally {
        clearTimeout(timer);
      }
    });
  });
}
