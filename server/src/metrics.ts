import http from "node:http";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { ProcessOutcome } from "./coach/process.ts";
import { shortKey } from "./people/people.ts";

/** How a metric names a person: the short id the logs use, and owner or guest. Never an email, never the whole key (2.2 §8). */
export interface PersonLabels {
  person: string;
  role: "owner" | "guest";
}

export interface Metrics {
  registry: Registry;
  httpRequests: Counter<"method" | "route" | "status">;
  httpDuration: Histogram<"method" | "route">;
  requestsByPerson: Counter<"person" | "role">;
  coachMessages: Counter<"outcome" | "person" | "role">;
  coachModelCalls: Counter<"person" | "role">;
  coachTokens: Counter<"kind" | "person" | "role">;
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
    // prom-client's default buckets, 5 ms to 10 s.
    httpDuration: new Histogram<"method" | "route">({
      name: "fitnessai_http_request_duration_seconds", help: "HTTP request duration",
      labelNames: ["method", "route"], registers: [registry],
    }),
    requestsByPerson: new Counter<"person" | "role">({
      name: "fitnessai_requests_by_person_total", help: "Signed-in API requests by person (short id) and role",
      labelNames: ["person", "role"], registers: [registry],
    }),
    coachMessages: new Counter<"outcome" | "person" | "role">({
      name: "fitnessai_coach_messages_total", help: "Coach messages by outcome",
      labelNames: ["outcome", "person", "role"], registers: [registry],
    }),
    coachModelCalls: new Counter<"person" | "role">({
      name: "fitnessai_coach_model_calls_total", help: "Calls to the Claude API",
      labelNames: ["person", "role"], registers: [registry],
    }),
    coachTokens: new Counter<"kind" | "person" | "role">({
      name: "fitnessai_coach_tokens_total", help: "Claude tokens by kind",
      labelNames: ["kind", "person", "role"], registers: [registry],
    }),
  };
}

/** A signed-in person's labels: `shortKey` of their key (the id the logs use) and their role. */
export function personLabels(person: { key: string; owner: boolean }): PersonLabels {
  return { person: shortKey(person.key), role: person.owner ? "owner" : "guest" };
}

export function recordCoach(metrics: Metrics | undefined, result: ProcessOutcome | null, who: PersonLabels): void {
  if (!metrics) return;
  // Exactly these two labels, whatever else the caller's object carries.
  const { person, role } = who;
  metrics.coachMessages.inc({ outcome: result?.outcome ?? "internal", person, role });
  if (!result) return;
  metrics.coachModelCalls.inc({ person, role }, result.calls);
  if (result.usage) {
    for (const kind of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const) {
      metrics.coachTokens.inc({ kind, person, role }, result.usage[kind]);
    }
  }
}

/** Prometheus scrapes this port; no Ingress routes to it, so it is never public (spec §13). */
export function serveMetrics(metrics: Metrics, port: number, host = "0.0.0.0"): Promise<http.Server> {
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
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
