import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { processMessage } from "../coach/process.ts";
import type { ProcessOutcome } from "../coach/process.ts";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getMessage, getReply, insertUserMessage, setMessageStatus, toChatMessage } from "../messages/messages.ts";
import { getProfile } from "../profile/profile.ts";
import { MAX_BACKDATE_DAYS, MessageInput, daysBetween } from "../shared.ts";
import type { MessageResult } from "../shared.ts";
import { localDate, todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

/** Coach failures are recorded on the message; only an unexpected crash lands here. */
async function runSafely(deps: AppDeps, id: string, log: FastifyBaseLogger): Promise<ProcessOutcome | null> {
  try {
    return await processMessage({ db: deps.db, ai: deps.ai, now: deps.now, budgetMs: deps.coachBudgetMs }, id);
  } catch (err) {
    log.error({ err }, "coach processing failed");
    setMessageStatus(deps.db, id, "failed", "internal");
    return null;
  }
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

    deps.db.transaction((tx) => {
      ensureDay(tx, profile, date, nowIso);
      insertUserMessage(tx, { id: input.id, date, text: input.text, sentAt: sentAt.toISOString(), nowIso });
    });
    await runSafely(deps, input.id, req.log);
    return reply.code(201).send(messageResult(deps, input.id));
  });

  app.post<{ Params: { id: string } }>("/api/messages/:id/retry", async (req, reply) => {
    const existing = getMessage(deps.db, req.params.id);
    if (!existing || existing.role !== "user") return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "failed") return reply.code(409).send({ error: "not_failed" });
    setMessageStatus(deps.db, existing.id, "pending", null);
    await runSafely(deps, existing.id, req.log);
    return messageResult(deps, existing.id);
  });
}
