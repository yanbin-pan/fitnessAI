import http from "node:http";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { ProcessOutcome, ProcessOutcomeCode } from "./coach/process.ts";
import { shortKey } from "./people/people.ts";

/**
 * How a metric names a person: their email if they're on the invite list, so the owner's dashboard shows who is who (the
 * owner's choice, 2026-10-08). Otherwise, for a guest taken off the list, the short id the logs use. Never the whole key.
 */
export interface PersonLabels {
  person: string;
  role: "owner" | "guest";
}

/** Each listed person's email by key: OWNER_EMAIL and ALLOWED_EMAILS, lowercased as the app reads them. */
export type PersonNames = ReadonlyMap<string, string>;

export interface Metrics {
  registry: Registry;
  /** Who the labels name by email; anyone missing here is named by short id. */
  names: PersonNames;
  httpRequests: Counter<"method" | "route" | "status">;
  httpDuration: Histogram<"method" | "route">;
  requestsByPerson: Counter<"person" | "role">;
  coachMessages: Counter<"outcome" | "person" | "role">;
  coachModelCalls: Counter<"person" | "role">;
  coachTokens: Counter<"kind" | "person" | "role">;
}

export function createMetrics(names: PersonNames = new Map()): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    names,
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
      name: "fitnessai_requests_by_person_total", help: "Signed-in API requests by person (email, or short id if not on the list) and role",
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

/** A person's labels: their email from `names`, else `shortKey` of their key (the id the logs use), and their role. */
export function personLabels(person: { key: string; owner: boolean }, names?: PersonNames): PersonLabels {
  return { person: names?.get(person.key) ?? shortKey(person.key), role: person.owner ? "owner" : "guest" };
}

/** The kinds of Claude token a coach run counts. */
const TOKEN_KINDS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const;

/**
 * Every outcome a coach message can end with ("internal" for a run that crashed). Written as a Record so tsc names
 * any outcome missing here: each is seeded per person, so a first failure after a restart still shows as growth.
 */
const OUTCOMES = Object.keys({
  done: 0, ai_cap: 0, ai_unavailable: 0, no_profile: 0, timeout: 0, ai_error: 0, ai_rate_limited: 0, refused: 0,
  max_tokens: 0, tool_loop_limit: 0, internal: 0,
} satisfies Record<ProcessOutcomeCode | "internal", 0>);

export function recordCoach(metrics: Metrics | undefined, result: ProcessOutcome | null, who: PersonLabels): void {
  if (!metrics) return;
  // Exactly these two labels, whatever else the caller's object carries.
  const { person, role } = who;
  metrics.coachMessages.inc({ outcome: result?.outcome ?? "internal", person, role });
  if (!result) return;
  metrics.coachModelCalls.inc({ person, role }, result.calls);
  if (result.usage) {
    for (const kind of TOKEN_KINDS) {
      metrics.coachTokens.inc({ kind, person, role }, result.usage[kind]);
    }
  }
}

/**
 * Starts each person's counters at zero when the app starts. Prometheus reads growth between two scrapes, so a series
 * that is born at 1 (a person's first request or message after a restart) shows no growth in increase() or rate().
 * Every message outcome is seeded, so the first refusal or failure after a restart shows too.
 */
export function seedPeople(metrics: Metrics, people: { key: string; owner: boolean }[]): void {
  for (const person of people) {
    const labels = personLabels(person, metrics.names);
    metrics.requestsByPerson.inc(labels, 0);
    metrics.coachModelCalls.inc(labels, 0);
    for (const outcome of OUTCOMES) metrics.coachMessages.inc({ outcome, ...labels }, 0);
    for (const kind of TOKEN_KINDS) metrics.coachTokens.inc({ kind, ...labels }, 0);
  }
}

/** One person's estimated Anthropic spend so far, in US dollars. */
export interface Spend {
  person: { key: string; owner: boolean };
  dollars: number;
}

/**
 * Each person's estimated Anthropic spend so far, worked out again from their usage records on every scrape. Those
 * records are kept for good, so the total survives restarts and, while the prices stay the same, only grows as calls
 * are made: what a Prometheus counter has to do, so increase() gives the spend over any window. Editing a price
 * re-prices everything recorded so far (ai/pricing.ts); a cut makes the series fall, which Prometheus reads as a reset.
 */
export function registerSpend(metrics: Metrics, read: () => Spend[]): void {
  new Counter<"person" | "role">({
    name: "fitnessai_ai_cost_dollars_total",
    help: "Estimated Anthropic API spend in US dollars at list prices, from each person's recorded model usage (coach and insights)",
    labelNames: ["person", "role"],
    registers: [metrics.registry],
    collect() {
      this.reset();
      for (const { person, dollars } of read()) this.inc(personLabels(person, metrics.names), dollars);
    },
  });
}

/** One person's interactions of one kind with their companion: all time, this calendar month and the one before. */
export interface CompanionInteractionCounts {
  person: { key: string; owner: boolean };
  kind: string;
  total: number;
  /** In the person's timezone. */
  thisMonth: number;
  lastMonth: number;
}

/**
 * How much each person interacts with their companion (2026-10-08 companions design §8), worked out again from their
 * own records on every scrape, as the spend is: the records are kept for good, so the counts survive restarts and don't
 * depend on Prometheus's 7-day retention. The total is a counter (increase() over any window); the monthly gauge gives
 * this calendar month and the one before by `period`, so a month reads whole even when Prometheus holds only a week.
 */
export function registerCompanionInteractions(metrics: Metrics, read: () => CompanionInteractionCounts[]): void {
  new Counter<"kind" | "person" | "role">({
    name: "fitnessai_companion_interactions_total",
    help: "Interactions with the companion so far, by kind (pet: a tap that pets it; open: its bubble opened), from each person's own records",
    labelNames: ["kind", "person", "role"],
    registers: [metrics.registry],
    collect() {
      this.reset();
      for (const counts of read()) this.inc({ kind: counts.kind, ...personLabels(counts.person, metrics.names) }, counts.total);
    },
  });
  new Gauge<"kind" | "period" | "person" | "role">({
    name: "fitnessai_companion_interactions_month",
    help: "Interactions with the companion in a calendar month of the person's timezone: period this_month or last_month",
    labelNames: ["kind", "period", "person", "role"],
    registers: [metrics.registry],
    collect() {
      this.reset();
      for (const counts of read()) {
        const labels = { kind: counts.kind, ...personLabels(counts.person, metrics.names) };
        this.set({ ...labels, period: "this_month" }, counts.thisMonth);
        this.set({ ...labels, period: "last_month" }, counts.lastMonth);
      }
    },
  });
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
