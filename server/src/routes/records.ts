import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AiClient } from "../ai/client.ts";
import { callsOn, recordRun } from "../coach/usage.ts";
import { photos } from "../db/schema.ts";
import { forRequest } from "../deps.ts";
import type { AppDeps, RequestDeps } from "../deps.ts";
import { CHAT_BUDGET_MS, chatPrompt, chatView, getChatMessage, replyInChat, saveExchange } from "../health/chat.ts";
import { markerFood } from "../health/food.ts";
import { READ_BUDGET_MS, readDocument } from "../health/read.ts";
import {
  acceptSuggestion, addDocument, addFact, consentedAt, deleteHealthData, dismissSuggestion, grantConsent, healthContext, healthView,
  listFacts, mergeDocuments, removeDocument, removeFact, undoSuggestion, updateFact,
} from "../health/records.ts";
import { deletePhotoFiles, photoData } from "../photos/photos.ts";
import type { PhotoData } from "../photos/photos.ts";
import { getProfile } from "../profile/profile.ts";
import { DocumentInput, DocumentMergeInput, DocumentReadInput, FactInput, HealthChatInput, LANGUAGE_NAMES, SuggestionAcceptInput } from "../shared.ts";
import type { DocumentReadView, FactView, HealthChatView, HealthView, MarkerFoodView, Profile, SuggestionView } from "../shared.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

// The Health tab (2026-10-19 health tab design), on the person's health.db. Every write needs their consent first;
// deleting their health data takes the consent away with it. Nothing reaches the profile without a tap of theirs: the
// coach's finds are suggestions until accepted.

/** What every route that asks Claude checks first: a profile, the coach switched on, and today's calls under the cap. */
function aiGate(deps: RequestDeps, reply: FastifyReply): { ai: AiClient; profile: Profile; today: string } | null {
  const profile = getProfile(deps.db);
  if (!profile) {
    void reply.code(409).send({ error: "no_profile" });
    return null;
  }
  const ai = deps.ai;
  if (!ai) {
    void reply.code(503).send({ error: "ai_unavailable" });
    return null;
  }
  const today = todayIn(profile.timezone, deps.now());
  const cap = deps.person.owner ? deps.callCaps.owner : deps.callCaps.guest;
  if (callsOn(deps.db, today) >= cap) {
    void reply.code(429).send({ error: "ai_cap" });
    return null;
  }
  return { ai, profile, today };
}

/**
 * The person's own uploads no message has claimed (a photo of the Today chat stays the chat's), and how to forget them:
 * once read they have no further use (design §2).
 */
function takePhotos(deps: RequestDeps, ids: readonly string[]): { images: PhotoData[]; forget: () => void } | null {
  if (ids.length === 0) return { images: [], forget: () => undefined };
  const rows = deps.db.select().from(photos).where(inArray(photos.id, [...ids])).all().filter((p) => p.message_id === null);
  const forget = () => {
    deps.db.delete(photos).where(inArray(photos.id, rows.map((r) => r.id))).run();
    deletePhotoFiles(deps.photoDir, rows);
  };
  if (rows.length !== ids.length) return null;
  const images = ids.map((id) => photoData(deps.db, deps.photoDir, id)).filter((p): p is PhotoData => p !== null);
  if (images.length !== ids.length) {
    forget();
    return null;
  }
  return { images, forget };
}

async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function registerRecordRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/records", async (req) => healthView(forRequest(appDeps, req).health) satisfies HealthView);

  app.post("/api/records/consent", async (req) => {
    const deps = forRequest(appDeps, req);
    grantConsent(deps.health, deps.now().toISOString());
    return healthView(deps.health) satisfies HealthView;
  });

  app.delete("/api/records", async (req, reply) => {
    deleteHealthData(forRequest(appDeps, req).health);
    return reply.code(204).send();
  });

  // Everything below is refused until the person has agreed.
  void app.register(async (records) => {
    records.addHook("preHandler", async (req, reply) => {
      if (!consentedAt(forRequest(appDeps, req).health)) return reply.code(409).send({ error: "no_consent" });
    });

    // Everything the Health tab holds, to keep or take to a doctor: a file, never a log line.
    records.get("/api/records/export", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const body = { exported_at: deps.now().toISOString(), ...healthView(deps.health) };
      return reply.header("content-disposition", 'attachment; filename="health-records.json"').send(body);
    });

    records.post("/api/records/facts", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(FactInput, req.body, reply);
      if (!input) return reply;
      return reply.code(201).send(addFact(deps.health, input, deps.now().toISOString()) satisfies FactView);
    });

    records.put<{ Params: { id: string } }>("/api/records/facts/:id", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(FactInput, req.body, reply);
      if (!input) return reply;
      const updated = updateFact(deps.health, req.params.id, input, deps.now().toISOString());
      return updated ?? reply.code(404).send({ error: "not_found" });
    });

    records.delete<{ Params: { id: string } }>("/api/records/facts/:id", async (req, reply) => {
      const found = removeFact(forRequest(appDeps, req).health, req.params.id);
      return found ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });

    records.post("/api/records/documents", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(DocumentInput, req.body, reply);
      if (!input) return reply;
      addDocument(deps.health, input, deps.now().toISOString());
      return reply.code(201).send(healthView(deps.health) satisfies HealthView);
    });

    // The person's merge: the records in `ids` join this one.
    records.post<{ Params: { id: string } }>("/api/records/documents/:id/merge", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(DocumentMergeInput, req.body, reply);
      if (!input) return reply;
      const found = mergeDocuments(deps.health, req.params.id, input.ids, deps.now().toISOString());
      return found ? (healthView(deps.health) satisfies HealthView) : reply.code(404).send({ error: "not_found" });
    });

    records.delete<{ Params: { id: string } }>("/api/records/documents/:id", async (req, reply) => {
      const found = removeDocument(forRequest(appDeps, req).health, req.params.id);
      return found ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });

    records.post<{ Params: { id: string } }>("/api/records/suggestions/:id/accept", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(SuggestionAcceptInput, req.body ?? {}, reply);
      if (!input) return reply;
      const result = acceptSuggestion(deps.health, req.params.id, input.fact, deps.now().toISOString());
      return result ?? reply.code(404).send({ error: "not_found" });
    });

    records.post<{ Params: { id: string } }>("/api/records/suggestions/:id/dismiss", async (req, reply) => {
      const result = dismissSuggestion(forRequest(appDeps, req).health, req.params.id);
      return (result satisfies SuggestionView | null) ?? reply.code(404).send({ error: "not_found" });
    });

    records.post<{ Params: { id: string } }>("/api/records/suggestions/:id/undo", async (req, reply) => {
      const result = undoSuggestion(forRequest(appDeps, req).health, req.params.id);
      return result ?? reply.code(404).send({ error: "not_found" });
    });

    records.get<{ Params: { key: string } }>("/api/records/markers/:key", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const trend = healthView(deps.health).trends.find((t) => t.key === req.params.key);
      if (!trend) return reply.code(404).send({ error: "not_found" });
      const profile = getProfile(deps.db);
      const today = todayIn(profile?.timezone ?? "UTC", deps.now());
      return markerFood(deps.db, trend, today) satisfies MarkerFoodView;
    });

    // Reads photos of a record for the person to check. Nothing is saved, and the photos are deleted whatever the outcome.
    records.post("/api/records/read", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(DocumentReadInput, req.body, reply);
      if (!input) return reply;
      const taken = takePhotos(deps, input.photo_ids);
      if (!taken) return reply.code(404).send({ error: "photo_not_found" });
      try {
        const gate = aiGate(deps, reply);
        if (!gate) return reply;
        const outcome = await withTimeout(READ_BUDGET_MS, (signal) => readDocument(gate.ai, taken.images, LANGUAGE_NAMES[gate.profile.language], signal));
        // Counts against the daily cap like a coach message, a failed read too.
        recordRun(deps.db, { messageId: `read:${input.photo_ids[0]}`, date: gate.today, model: outcome.model, calls: 1, usage: outcome.usage, nowIso: deps.now().toISOString() });
        if (!outcome.ok) return reply.code(outcome.failure === "unreadable" ? 422 : 502).send({ error: `read_${outcome.failure}` });
        return outcome.read satisfies DocumentReadView;
      } finally {
        taken.forget();
      }
    });

    records.get("/api/records/chat", async (req) => chatView(forRequest(appDeps, req).health) satisfies HealthChatView);

    // One message to the Health chat: photos are read as a record to check and save, words get the coach's answer and its
    // proposals. A message id already answered is a repeat and changes nothing.
    records.post("/api/records/chat", async (req, reply) => {
      const deps = forRequest(appDeps, req);
      const input = parseBody(HealthChatInput, req.body, reply);
      if (!input) return reply;
      if (getChatMessage(deps.health, input.id)) return chatView(deps.health) satisfies HealthChatView;
      const taken = takePhotos(deps, input.photo_ids);
      if (!taken) return reply.code(404).send({ error: "photo_not_found" });
      try {
        const gate = aiGate(deps, reply);
        if (!gate) return reply;
        const sentAt = deps.now();
        const record = (model: string | null, usage: Parameters<typeof recordRun>[1]["usage"]) =>
          recordRun(deps.db, { messageId: `health:${input.id}`, date: gate.today, model, calls: 1, usage, nowIso: deps.now().toISOString() });
        let answer: { text: string; options: string[]; read: DocumentReadView | null; facts: Parameters<typeof saveExchange>[2]["facts"] };
        if (taken.images.length > 0) {
          const outcome = await withTimeout(READ_BUDGET_MS, (signal) => readDocument(gate.ai, taken.images, LANGUAGE_NAMES[gate.profile.language], signal));
          record(outcome.model, outcome.usage);
          if (!outcome.ok) return reply.code(outcome.failure === "unreadable" ? 422 : 502).send({ error: `read_${outcome.failure}` });
          // The phone words the reply from the read, in the person's language; the facts are ticked on its check sheet.
          answer = { text: "", options: [], read: outcome.read, facts: [] };
        } else {
          const prompt = chatPrompt({
            today: gate.today,
            language: LANGUAGE_NAMES[gate.profile.language],
            profile: healthContext(deps.health),
            facts: listFacts(deps.health),
            history: chatView(deps.health).messages,
            text: input.text,
          });
          const outcome = await withTimeout(CHAT_BUDGET_MS, (signal) => replyInChat(gate.ai, gate.profile.companion, prompt, signal));
          record(outcome.model, outcome.usage);
          if (!outcome.ok) return reply.code(502).send({ error: `chat_${outcome.failure}` });
          answer = { text: outcome.reply, options: outcome.options, read: null, facts: outcome.facts };
        }
        // A millisecond on, so the reply always sorts after its question.
        const repliedAt = new Date(Math.max(deps.now().getTime(), sentAt.getTime() + 1)).toISOString();
        saveExchange(
          deps.health,
          { id: input.id, text: input.text, photos: taken.images.length, createdAt: sentAt.toISOString() },
          { id: randomUUID(), ...answer, createdAt: repliedAt },
        );
        return chatView(deps.health) satisfies HealthChatView;
      } finally {
        taken.forget();
      }
    });
  });
}
