import { eq } from "drizzle-orm";
import { profile as profileTable } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { COMPANION_CHANGE_MONTHS, ProfileInput, addMonths } from "../shared.ts";
import type { Profile } from "../shared.ts";

export function getProfile(sql: Sql): Profile | null {
  const row = sql.select().from(profileTable).where(eq(profileTable.id, 1)).get();
  // Parsing narrows the text columns to their enums; unknown keys (id, updated_at) are dropped.
  return row ? ProfileInput.parse(row) : null;
}

export function saveProfile(sql: Sql, profile: Profile, nowIso: string): Profile {
  sql
    .insert(profileTable)
    .values({ ...profile, id: 1, updated_at: nowIso })
    .onConflictDoUpdate({ target: profileTable.id, set: { ...profile, updated_at: nowIso } })
    .run();
  return profile;
}

/** The person's local date of the last change of companion, or null when it was never changed. */
export function companionChangedAt(sql: Sql): string | null {
  return sql.select({ at: profileTable.companion_changed_at }).from(profileTable).where(eq(profileTable.id, 1)).get()?.at ?? null;
}

export function setCompanionChangedAt(sql: Sql, date: string): void {
  sql.update(profileTable).set({ companion_changed_at: date }).where(eq(profileTable.id, 1)).run();
}

/** The first day the companion can change again, while that is after `today` (2026-10-08 companions design §7). */
export function companionLockedUntil(changedAt: string | null, today: string): string | null {
  if (!changedAt) return null;
  const until = addMonths(changedAt, COMPANION_CHANGE_MONTHS);
  return until > today ? until : null;
}
