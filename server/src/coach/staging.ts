import type { z } from "zod";
import { ensureDay } from "../days/days.ts";
import type { Sql } from "../db/types.ts";
import { getEntry, insertEntry, replaceEntryItems } from "../log/entries.ts";
import type { ExerciseItemData, FoodItemData, NewEntry } from "../log/entries.ts";
import { MAX_BACKDATE_DAYS, TIME_HHMM, daysBetween, isIsoDate } from "../shared.ts";
import type { EntrySource, Profile } from "../shared.ts";
import { exerciseKcal } from "../targets/targets.ts";
import { zonedTimeToInstant } from "../time.ts";
import { LogItemsInput, UpdateEntryInput, amountIssues } from "./tools.ts";
import type { ExerciseToolItem, FoodToolItem } from "./tools.ts";

// Tool calls are validated and STAGED here; nothing touches the database until
// the whole coach loop succeeds and applyStaging() runs in the final transaction.

export interface Staging {
  creates: NewEntry[];
  updates: Map<string, { foods: FoodItemData[]; exercises: ExerciseItemData[] }>;
}

export function newStaging(): Staging {
  return { creates: [], updates: new Map() };
}

export interface ToolContext {
  sql: Sql;
  profile: Profile;
  messageId: string;
  /** `photo` when the message had photos, otherwise `coach` (spec §5). */
  source: EntrySource;
  /** The day the message belongs to. */
  messageDate: string;
  sentAt: Date;
  today: string;
  /** The weight frozen in that day's snapshot, for exercise calories. */
  weightKg: (date: string) => number;
  staging: Staging;
  newId: () => string;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

const ok = (value: Record<string, unknown>): ToolOutcome => ({ content: JSON.stringify({ ok: true, ...value }), isError: false });
const fail = (message: string): ToolOutcome => ({ content: JSON.stringify({ ok: false, error: message }), isError: true });

function zodFailure(error: z.ZodError): ToolOutcome {
  return fail(error.issues.map((issue) => `${issue.path.map(String).join(".") || "input"}: ${issue.message}`).join("; "));
}

function foodFromTool(food: FoodToolItem): FoodItemData {
  return { ...food, saved_food_id: null };
}

function exerciseFromTool(item: ExerciseToolItem, weightKg: number): ExerciseItemData {
  return { ...item, avg_hr: null, kcal: exerciseKcal(item.met, weightKg, item.duration_min), kcal_measured: false };
}

function summary(id: string, date: string, foods: FoodItemData[], exercises: ExerciseItemData[]) {
  return {
    entry_id: id,
    date,
    foods: foods.map((f) => ({ name: f.name, kcal: Math.round(f.kcal) })),
    exercises: exercises.map((x) => ({ name: x.name, kcal: Math.round(x.kcal) })),
  };
}

function logItems(raw: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = LogItemsInput.safeParse(raw);
  if (!parsed.success) return zodFailure(parsed.error);
  const input = parsed.data;
  const date = input.date ?? ctx.messageDate;
  if (!isIsoDate(date)) return fail(`date must be YYYY-MM-DD, got "${date}"`);
  if (date > ctx.today) return fail("date is in the future");
  if (daysBetween(date, ctx.today) > MAX_BACKDATE_DAYS) return fail(`date is more than ${MAX_BACKDATE_DAYS} days ago`);
  if (input.time !== null && !TIME_HHMM.test(input.time)) return fail(`time must be HH:MM, got "${input.time}"`);
  const issues = amountIssues(input);
  if (issues.length > 0) return fail(issues.join("; "));

  const timeZone = ctx.profile.timezone;
  const loggedAt =
    input.time !== null ? zonedTimeToInstant(date, input.time, timeZone)
    : date === ctx.messageDate ? ctx.sentAt
    : zonedTimeToInstant(date, "12:00", timeZone);
  const weight = ctx.weightKg(date);
  const entry: NewEntry = {
    id: ctx.newId(),
    date,
    logged_at: loggedAt.toISOString(),
    source: ctx.source,
    message_id: ctx.messageId,
    foods: input.foods.map(foodFromTool),
    exercises: input.exercises.map((item) => exerciseFromTool(item, weight)),
  };
  ctx.staging.creates.push(entry);
  return ok(summary(entry.id, date, entry.foods, entry.exercises));
}

function updateEntry(raw: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = UpdateEntryInput.safeParse(raw);
  if (!parsed.success) return zodFailure(parsed.error);
  const input = parsed.data;
  const issues = amountIssues(input);
  if (issues.length > 0) return fail(issues.join("; "));

  const staged = ctx.staging.creates.find((e) => e.id === input.entry_id);
  if (staged) {
    const weight = ctx.weightKg(staged.date);
    staged.foods = input.foods.map(foodFromTool);
    staged.exercises = input.exercises.map((item) => exerciseFromTool(item, weight));
    return ok(summary(staged.id, staged.date, staged.foods, staged.exercises));
  }

  const existing = getEntry(ctx.sql, input.entry_id);
  if (!existing) return fail(`there is no entry with id ${input.entry_id}`);
  if (daysBetween(existing.date, ctx.today) > MAX_BACKDATE_DAYS) {
    return fail(`entries older than ${MAX_BACKDATE_DAYS} days can't be changed here`);
  }
  const weight = ctx.weightKg(existing.date);
  const foods = input.foods.map(foodFromTool);
  const exercises = input.exercises.map((item) => exerciseFromTool(item, weight));
  ctx.staging.updates.set(existing.id, { foods, exercises });
  return ok(summary(existing.id, existing.date, foods, exercises));
}

export function executeTool(name: string, input: unknown, ctx: ToolContext): ToolOutcome {
  if (name === "log_items") return logItems(input, ctx);
  if (name === "update_entry") return updateEntry(input, ctx);
  return fail(`unknown tool ${name}`);
}

/** Writes everything staged. Run inside the message's final transaction. */
export function applyStaging(sql: Sql, staging: Staging, profile: Profile, nowIso: string): string[] {
  const changed: string[] = [];
  for (const entry of staging.creates) {
    ensureDay(sql, profile, entry.date, nowIso);
    insertEntry(sql, entry, nowIso);
    changed.push(entry.id);
  }
  // An entry deleted while the coach was thinking stays deleted, and gets no card.
  for (const [id, items] of staging.updates) {
    if (replaceEntryItems(sql, id, items.foods, items.exercises, nowIso)) changed.push(id);
  }
  return changed;
}
