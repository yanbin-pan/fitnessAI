import http from "node:http";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";
import type { ProcessOutcome } from "./coach/process.ts";

export interface Metrics {
  registry: Registry;
  httpRequests: Counter<"method" | "route" | "status">;
  coachMessages: Counter<"outcome">;
  coachModelCalls: Counter;
  coachTokens: Counter<"kind">;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpRequests: new Counter<"method" | "route" | "status">({
      name: "fitnessai_http_requests_total", help: "HTTP requests by route and status",
      labelNames: ["method", "route", "status"], registers: [registry],
    }),
    coachMessages: new Counter<"outcome">({
      name: "fitnessai_coach_messages_total", help: "Coach messages by outcome",
      labelNames: ["outcome"], registers: [registry],
    }),
    coachModelCalls: new Counter({ name: "fitnessai_coach_model_calls_total", help: "Calls to the Claude API", registers: [registry] }),
    coachTokens: new Counter<"kind">({
      name: "fitnessai_coach_tokens_total", help: "Claude tokens by kind",
      labelNames: ["kind"], registers: [registry],
    }),
  };
}

export function recordCoach(metrics: Metrics | undefined, result: ProcessOutcome | null): void {
  if (!metrics) return;
  metrics.coachMessages.inc({ outcome: result?.outcome ?? "internal" });
  if (!result) return;
  metrics.coachModelCalls.inc(result.calls);
  if (result.usage) for (const [kind, count] of Object.entries(result.usage)) metrics.coachTokens.inc({ kind }, count);
}

/** Prometheus scrapes this port; no Ingress routes to it, so it is never public (spec §13). */
export function serveMetrics(metrics: Metrics, port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.statusCode = 404;
      res.end();
      return;
    }
    metrics.registry.metrics().then(
      (body) => {
        res.setHeader("content-type", metrics.registry.contentType);
        res.end(body);
      },
      () => {
        res.statusCode = 500;
        res.end();
      },
    );
  });
  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server)));
}
