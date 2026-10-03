import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { registerDayRoutes } from "./days.ts";
import { registerEntryRoutes } from "./entries.ts";
import { registerHealth } from "./health.ts";
import { registerProfileRoutes } from "./profile.ts";

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerHealth(app);
  registerProfileRoutes(app, deps);
  registerDayRoutes(app, deps);
  registerEntryRoutes(app, deps);
}
