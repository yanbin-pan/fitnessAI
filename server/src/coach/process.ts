import { randomUUID } from "node:crypto";
import type { AiClient, AiMessage, AiUsage } from "../ai/client.ts";
import { buildDayView, getDay, recentDays, snapshotValues } from "../days/days.ts";
import type { Sql } from "../db/types.ts";
import { getMessage, insertReply, setMessageStatus } from "../messages/messages.ts";
import { photoData } from "../photos/photos.ts";
import { getProfile } from "../profile/profile.ts";
import { todayIn } from "../time.ts";
import { runCoachLoop } from "./loop.ts";
import type { CoachFailure, LoopStep } from "./loop.ts";
import { PHOTOS_ONLY_TEXT, hydrateTurns, photoRef } from "./photo-blocks.ts";
import { buildSystemPrompt, buildTurnContext } from "./prompt.ts";
import { applyStaging, executeTool, fillsInPastDay, newStaging } from "./staging.ts";
import type { ToolContext } from "./staging.ts";
import { stepText } from "./steps.ts";
import { appendTurns, getOrCreateThread, loadTurns } from "./thread.ts";
import { COACH_TOOLS } from "./tools.ts";
import { callsOn, recordRun } from "./usage.ts";

export const MAX_MODEL_CALLS = 5;

export interface CoachDeps {
  db: Sql;
  ai: AiClient | null;
  now: () => Date;
  budgetMs: number;
  /** Where the message's photos are stored (spec §6.5). */
  photoDir: string;
  /** Model calls this person may start per local day (2.2 §6): AI_DAILY_CALL_CAP for the owner, GUEST_DAILY_CALL_CAP for a guest. */
  dailyCallCap: number;
  newId?: () => string;
  /** Hears each step of the work (spec §6.3). Best effort: it can never stop the coach. */
  onStep?: (text: string) => void;
}

export type ProcessOutcomeCode = "done" | CoachFailure | "ai_unavailable" | "no_profile" | "ai_cap";

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

/** A failure before Claude was called: nothing to count against the cap. */
function fail(sql: Sql, id: string, outcome: ProcessOutcomeCode): ProcessOutcome {
  setMessageStatus(sql, id, "failed", outcome);
  return { outcome, calls: 0, usage: null };
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
  // Checked before the first call: a run that starts under the cap may end a few calls over it (2.2 §6).
  if (callsOn(deps.db, today) >= deps.dailyCallCap) return fail(deps.db, messageId, "ai_cap");
  const system = getOrCreateThread(deps.db, message.date, () => buildSystemPrompt(profile, message.date), nowIso);
  const load = (id: string) => photoData(deps.db, deps.photoDir, id);
  const history = hydrateTurns(loadTurns(deps.db, message.date), load);
  // The coach's context never shows the featured row.
  const view = buildDayView(deps.db, profile, message.date, today, nowIso, []);
  // What is stored keeps a reference per photo. What Claude receives is rebuilt from it by
  // the same function every later replay uses, so the two can never differ.
  const sentAt = new Date(message.sent_at ?? message.created_at);
  const storedTurn: AiMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: buildTurnContext(
          view,
          now,
          profile.timezone,
          profile.language,
          fillsInPastDay(message.date, sentAt, profile.timezone),
          recentDays(deps.db, profile, message.date, nowIso),
        ),
      },
      ...message.photo_ids.map(photoRef),
      { type: "text", text: message.text || PHOTOS_ONLY_TEXT },
    ] as unknown as AiMessage["content"],
  };
  const [userTurn] = hydrateTurns([storedTurn], load);
  const staging = newStaging();
  const context: ToolContext = {
    sql: deps.db,
    profile,
    messageId,
    source: message.photo_ids.length > 0 ? "photo" : "coach",
    messageDate: message.date,
    sentAt,
    today,
    weightKg: (date) => (getDay(deps.db, date) ?? snapshotValues(profile, date, nowIso)).weight_kg_used,
    staging,
    newId: deps.newId ?? (() => randomUUID()),
  };

  const onStep = deps.onStep;
  const photos = message.photo_ids.length;
  const report = onStep
    ? (step: LoopStep) => {
        try {
          onStep(stepText(step, photos, profile.language));
        } catch {
          // Telling the phone how it is going must never cost the message.
        }
      }
    : undefined;

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
      onStep: report,
    }),
  );
  // Every run that reached Claude counts against the cap, a failed one too, so retrying can't run up the bill.
  const run = { messageId, date: today, model: result.model, calls: result.calls, usage: result.usage };
  if (!result.ok) {
    deps.db.transaction((tx) => {
      recordRun(tx, { ...run, nowIso: deps.now().toISOString() });
      setMessageStatus(tx, messageId, "failed", result.failure);
    });
    return { outcome: result.failure, calls: result.calls, usage: result.usage, detail: result.detail };
  }

  const doneIso = deps.now().toISOString();
  deps.db.transaction((tx) => {
    const changed = applyStaging(tx, staging, profile, doneIso);
    appendTurns(tx, message.date, messageId, [storedTurn, ...result.turns.slice(1)], doneIso);
    insertReply(tx, {
      id: randomUUID(),
      replyTo: messageId,
      date: message.date,
      text: result.replyText,
      cards: changed.map((id) => ({ type: "entry" as const, id })),
      nowIso: doneIso,
    });
    recordRun(tx, { ...run, nowIso: doneIso });
    setMessageStatus(tx, messageId, "done", null);
  });
  return { outcome: "done", calls: result.calls, usage: result.usage };
}
