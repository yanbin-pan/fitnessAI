import { eq } from "drizzle-orm";
import { profile as profileTable } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { ProfileInput } from "../shared.ts";
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
