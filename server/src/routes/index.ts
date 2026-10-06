import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { registerDayRoutes } from "./days.ts";
import { registerEntryRoutes } from "./entries.ts";
import { registerHealth } from "./health.ts";
import { registerInsightRoutes } from "./insights.ts";
import { registerMessageRoutes } from "./messages.ts";
import { registerPhotoRoutes } from "./photos.ts";
import { registerProfileRoutes } from "./profile.ts";
import { registerRegularRoutes } from "./regulars.ts";

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerHealth(app);
  registerProfileRoutes(app, deps);
  registerDayRoutes(app, deps);
  registerEntryRoutes(app, deps);
  registerMessageRoutes(app, deps);
  registerPhotoRoutes(app, deps);
  registerRegularRoutes(app, deps);
  registerInsightRoutes(app, deps);
}
