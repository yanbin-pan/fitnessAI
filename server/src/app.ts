import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { AuthError } from "./auth/access.ts";
import type { Identity } from "./auth/access.ts";
import type { AppDeps } from "./deps.ts";
import { LOGGER } from "./logging.ts";
import { registerRoutes } from "./routes/index.ts";

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

function pathOf(url: string): string {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

/** True for "/api" itself and everything under "/api/". */
function isApi(path: string | undefined): boolean {
  return path === "/api" || (path?.startsWith("/api/") ?? false);
}

/** Hashed build assets never change; everything else (index.html, sw.js, the manifest) must revalidate. */
export function cacheControlFor(filePath: string): string {
  return /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache";
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ? { ...LOGGER, ...(deps.logStream ? { stream: deps.logStream } : {}) } : false,
    bodyLimit: 1_048_576,
  });
  app.decorateRequest("identity", null);

  if (deps.metrics) {
    const requests = deps.metrics.httpRequests;
    app.addHook("onResponse", async (req, reply) => {
      // The route pattern, not the URL, keeps label cardinality bounded.
      requests.inc({ method: req.method, route: req.routeOptions.url ?? "unmatched", status: String(reply.statusCode) });
    });
  }

  // Fail closed: everything under /api except the health probe needs the owner's
  // Access token (spec §13). A refusal carries no body.
  // The router decodes percent-escapes and absolute-form targets before matching
  // ("/%61pi/x" reaches /api/x), so the matched route counts as well as the raw path.
  app.addHook("onRequest", async (req, reply) => {
    const route = req.routeOptions.url;
    if (route === "/api/health") return;
    if (!isApi(route) && !isApi(pathOf(req.url))) return;
    const header = req.headers["cf-access-jwt-assertion"];
    const token = typeof header === "string" ? header : "";
    try {
      req.identity = await deps.verifier.verify(token);
    } catch (err) {
      // Say why, never what: no token, email or payload. Requests without a token (probes,
      // stray scanners) stay quiet. jose's claim errors carry the payload, so never log `err`.
      if (token) {
        const e = err as { code?: unknown; claim?: unknown; name?: unknown };
        req.log.warn({ reason: e.code ?? e.name, claim: e.claim, detail: err instanceof AuthError ? err.message : undefined }, "access token refused");
      }
      return reply.code(401).send();
    }
  });

  app.setErrorHandler((err, req, reply) => {
    // Fastify types the error as unknown; client errors (bad JSON, body too large) carry a 4xx statusCode.
    const code = (err as { statusCode?: unknown }).statusCode;
    const status = typeof code === "number" && code < 500 ? code : 500;
    if (status === 500) req.log.error({ err }, "unhandled error");
    return reply.code(status).send({ error: status === 500 ? "internal" : "bad_request" });
  });

  registerRoutes(app, deps);

  const webDist = deps.webDist && fs.existsSync(deps.webDist) ? deps.webDist : null;
  if (webDist) {
    void app.register(fastifyStatic, {
      root: webDist,
      wildcard: true,
      setHeaders: (res, filePath) => res.header("cache-control", cacheControlFor(filePath)),
    });
  }

  // Unknown GETs outside /api/ are client-side routes of the PWA: answer with index.html.
  app.setNotFoundHandler((req, reply) => {
    if (!webDist || req.method !== "GET" || isApi(pathOf(req.url))) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });

  return app;
}
