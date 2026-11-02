import type { FastifyInstance } from "fastify";
import { forRequest } from "../deps.ts";
import type { AppDeps } from "../deps.ts";
import { MEMORY_ID, deleteAllMemories, deleteMemory, getMemory, listMemories, saveMemory } from "../memories/memories.ts";
import { getProfile } from "../profile/profile.ts";
import { MemoryInput } from "../shared.ts";
import type { Memory, MemoriesView } from "../shared.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

// What Zabaione remembers (2026-11-02 memories design): listed in Settings, edited, added or forgotten by the person.

export function registerMemoryRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/memories", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    return { enabled: profile.memories === "on", memories: listMemories(deps.db, todayIn(profile.timezone, deps.now())) } satisfies MemoriesView;
  });

  // Makes or replaces one under an id made on the phone (8 hex digits, as the coach's), so a repeated save is harmless.
  app.put<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    if (!MEMORY_ID.test(req.params.id)) return reply.code(404).send({ error: "not_found" });
    const input = parseBody(MemoryInput, req.body, reply);
    if (!input) return reply;
    if (!getProfile(deps.db)) return reply.code(409).send({ error: "no_profile" });
    const existing = getMemory(deps.db, req.params.id);
    if (!existing) reply.code(201);
    return saveMemory(deps.db, req.params.id, input, "person", deps.now().toISOString()) satisfies Memory;
  });

  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    deleteMemory(deps.db, req.params.id);
    return reply.code(204).send();
  });

  app.delete("/api/memories", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    deleteAllMemories(deps.db);
    return reply.code(204).send();
  });
}
