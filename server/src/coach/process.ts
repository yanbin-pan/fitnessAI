import { randomUUID } from "node:crypto";
import type { AiClient, AiMessage, AiUsage } from "../ai/client.ts";
import { buildDayView, getDay, snapshotValues } from "../days/days.ts";
import type { Sql } from "../db/types.ts";
import { getMessage, insertReply, setMessageStatus } from "../messages/messages.ts";
import { getProfile } from "../profile/profile.ts";
import { todayIn } from "../time.ts";
import { runCoachLoop } from "./loop.ts";
import type { CoachFailure } from "./loop.ts";
import { buildSystemPrompt, buildTurnContext } from "./prompt.ts";
import { applyStaging, executeTool, newStaging } from "./staging.ts";
import type { ToolContext } from "./staging.ts";
import { appendTurns, getOrCreateThread, loadTurns } from "./thread.ts";
import { COACH_TOOLS } from "./tools.ts";

export const MAX_MODEL_CALLS = 5;

export interface CoachDeps {
  db: Sql;
  ai: AiClient | null;
  now: () => Date;
  budgetMs: number;
  newId?: () => string;
}

export type ProcessOutcomeCode = "done" | CoachFailure | "ai_unavailable" | "no_profile";

export interface ProcessOutcome {
  outcome: ProcessOutcomeCode;
  calls: number;
  usage: AiUsage | null;
  /** Why it failed, for the log: Claude's error text, never the message itself. */
  detail?: string;
}

async function withBudget<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function fail(sql: Sql, id: string, outcome: ProcessOutcomeCode, calls = 0, usage: AiUsage | null = null, detail?: string): ProcessOutcome {
  setMessageStatus(sql, id, "failed", outcome);
  return { outcome, calls, usage, detail };
}

/**
 * Runs one user message through the coach. Nothing the coach does is written
 * until the whole loop has succeeded; then the entries, the conversation turns
 * and the reply commit in one transaction. A failure leaves only the failed
 * message, so Retry can never log the same meal twice.
 */
export async function processMessage(deps: CoachDeps, messageId: string): Promise<ProcessOutcome> {
  const message = getMessage(deps.db, messageId);
  if (!message) throw new Error(`message ${messageId} not found`);
  const profile = getProfile(deps.db);
  if (!profile) return fail(deps.db, messageId, "no_profile");
  const ai = deps.ai;
  if (!ai) return fail(deps.db, messageId, "ai_unavailable");

  const now = deps.now();
  const nowIso = now.toISOString();
  const today = todayIn(profile.timezone, now);
  const system = getOrCreateThread(deps.db, message.date, () => buildSystemPrompt(profile, message.date), nowIso);
  const history = loadTurns(deps.db, message.date);
  const view = buildDayView(deps.db, profile, message.date, today, nowIso);
  const userTurn: AiMessage = {
    role: "user",
    content: [
      { type: "text", text: buildTurnContext(view, now, profile.timezone) },
      { type: "text", text: message.text },
    ],
  };
  const staging = newStaging();
  const context: ToolContext = {
    sql: deps.db,
    profile,
    messageId,
    messageDate: message.date,
    sentAt: new Date(message.sent_at ?? message.created_at),
    today,
    weightKg: (date) => (getDay(deps.db, date) ?? snapshotValues(profile, date, nowIso)).weight_kg_used,
    staging,
    newId: deps.newId ?? (() => randomUUID()),
  };

  const result = await withBudget(deps.budgetMs, (signal) =>
    runCoachLoop({
      ai,
      system,
      tools: COACH_TOOLS,
      history,
      userTurn,
      execute: (name, input) => executeTool(name, input, context),
      signal,
      maxCalls: MAX_MODEL_CALLS,
    }),
  );
  if (!result.ok) return fail(deps.db, messageId, result.failure, result.calls, result.usage, result.detail);

  const doneIso = deps.now().toISOString();
  deps.db.transaction((tx) => {
    const changed = applyStaging(tx, staging, profile, doneIso);
    appendTurns(tx, message.date, messageId, result.turns, doneIso);
    insertReply(tx, {
      id: randomUUID(),
      replyTo: messageId,
      date: message.date,
      text: result.replyText,
      cards: changed.map((id) => ({ type: "entry" as const, id })),
      nowIso: doneIso,
    });
    setMessageStatus(tx, messageId, "done", null);
  });
  return { outcome: "done", calls: result.calls, usage: result.usage };
}
