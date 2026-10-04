import type { FastifyInstance } from "fastify";

export function registerHealth(app: FastifyInstance): void {
  // Exempt from auth (see app.ts) so the kubelet's probes reach it. Reveals nothing.
  app.get("/api/health", async () => ({ ok: true }));
}
