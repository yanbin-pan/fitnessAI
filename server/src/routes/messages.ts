import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { processMessage } from "../coach/process.ts";
import type { ProcessOutcome } from "../coach/process.ts";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getMessage, getReply, insertUserMessage, setMessageStatus, toChatMessage } from "../messages/messages.ts";
import { recordCoach } from "../metrics.ts";
import { claimPhotos } from "../photos/photos.ts";
import { getProfile } from "../profile/profile.ts";
import { MAX_BACKDATE_DAYS, MessageInput, daysBetween } from "../shared.ts";
import type { DayView, MessageResult } from "../shared.ts";
import { localDate, todayIn } from "../time.ts";
import { parseBody } from "./http.ts";
import { openEventStream } from "./stream.ts";

/** Coach failures are recorded on the message; only an unexpected crash lands in the catch. */
async function runSafely(deps: AppDeps, id: string, log: FastifyBaseLogger, onStep?: (text: string) => void): Promise<ProcessOutcome | null> {
  let outcome: ProcessOutcome | null = null;
  try {
    outcome = await processMessage({ db: deps.db, ai: deps.ai, now: deps.now, budgetMs: deps.coachBudgetMs, photoDir: deps.photoDir, onStep }, id);
  } catch (err) {
    log.error({ err }, "coach processing failed");
    setMessageStatus(deps.db, id, "failed", "internal");
  }
  if (outcome && outcome.outcome !== "done") log.warn({ outcome: outcome.outcome, detail: outcome.detail }, "coach message failed");
  recordCoach(deps.metrics, outcome);
  return outcome;
}

function messageResult(deps: AppDeps, id: string): MessageResult {
  const profile = getProfile(deps.db);
  const user = getMessage(deps.db, id);
  if (!profile || !user) throw new Error(`message ${id} or the profile disappeared`);
  const reply = getReply(deps.db, id);
  const now = deps.now();
  return {
    user: toChatMessage(user),
    reply: reply ? toChatMessage(reply) : null,
    day: buildDayView(deps.db, profile, user.date, todayIn(profile.timezone, now), now.toISOString()),
  };
}

/** How often a stream says it is still there while the coach thinks (spec §6.3). */
export const KEEP_ALIVE_MS = 15_000;

/** True when the phone asked to follow the coach's work as it happens (spec §6.3). */
function wantsStream(req: FastifyRequest): boolean {
  return (req.headers.accept ?? "").includes("text/event-stream");
}

/** The message's day as it stands now. */
function dayOf(deps: AppDeps, date: string): DayView {
  const profile = getProfile(deps.db);
  if (!profile) throw new Error("the profile disappeared");
  const now = deps.now();
  return buildDayView(deps.db, profile, date, todayIn(profile.timezone, now), now.toISOString());
}

/**
 * Runs a stored message through the coach as a stream: stored, each step, then the result. The coach's work
 * never depends on the stream: if an event can't be built, the stream ends without it and the phone looks again.
 */
async function streamWork(deps: AppDeps, req: FastifyRequest, reply: FastifyReply, id: string, date: string): Promise<FastifyReply> {
  const stream = openEventStream(reply, deps.streamKeepAliveMs ?? KEEP_ALIVE_MS);
  try {
    try {
      stream.send("stored", { day: dayOf(deps, date) });
    } catch (err) {
      req.log.error({ err }, "the stored event could not be built");
    }
    await runSafely(deps, id, req.log, (text) => stream.send("step", { text }));
    try {
      stream.send("result", messageResult(deps, id));
    } catch (err) {
      req.log.error({ err }, "the result event could not be built");
    }
  } catch (err) {
    // Once the stream has begun its headers are out and Fastify can no longer answer an error: a throw
    // from here would reach the process. End the stream instead; the phone looks again.
    req.log.error({ err }, "streaming the coach's work failed");
  } finally {
    stream.close();
  }
  return reply;
}

export function registerMessageRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/messages", async (req, reply) => {
    const input = parseBody(MessageInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });

    // The id is made on the phone: a repeat gets what the first attempt produced.
    const existing = getMessage(deps.db, input.id);
    if (existing) {
      if (existing.status === "pending") return reply.code(409).send({ error: "in_progress" });
      return messageResult(deps, existing.id);
    }

    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    const sentAt = new Date(input.sent_at);
    // The day is when it was sent, so a message typed at 23:55 stays on its day (spec §7.5).
    const date = localDate(sentAt, profile.timezone);
    if (date > today) return reply.code(400).send({ error: "future_date" });
    if (daysBetween(date, today) > MAX_BACKDATE_DAYS) return reply.code(400).send({ error: "too_old" });

    // The message claims its photos in the same transaction, so a refusal stores nothing.
    const claim = deps.db.transaction((tx) => {
      const claimed = claimPhotos(tx, input.photo_ids, input.id);
      if (!claimed.ok) return claimed;
      ensureDay(tx, profile, date, nowIso);
      insertUserMessage(tx, { id: input.id, date, text: input.text, photoIds: input.photo_ids, sentAt: sentAt.toISOString(), nowIso });
      return claimed;
    });
    if (!claim.ok) return reply.code(claim.error === "photo_taken" ? 409 : 400).send({ error: claim.error });
    if (wantsStream(req)) return streamWork(deps, req, reply, input.id, date);
    await runSafely(deps, input.id, req.log);
    return reply.code(201).send(messageResult(deps, input.id));
  });

  app.post<{ Params: { id: string } }>("/api/messages/:id/retry", async (req, reply) => {
    const existing = getMessage(deps.db, req.params.id);
    if (!existing || existing.role !== "user") return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "failed") return reply.code(409).send({ error: "not_failed" });
    setMessageStatus(deps.db, existing.id, "pending", null);
    if (wantsStream(req)) return streamWork(deps, req, reply, existing.id, existing.date);
    await runSafely(deps, existing.id, req.log);
    return messageResult(deps, existing.id);
  });
}
