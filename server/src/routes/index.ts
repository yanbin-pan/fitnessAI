import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { registerHealth } from "./health.ts";

export function registerRoutes(app: FastifyInstance, _deps: AppDeps): void {
  registerHealth(app);
}
