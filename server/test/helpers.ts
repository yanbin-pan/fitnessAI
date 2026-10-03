import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/open.ts";
import { ProfileInput } from "../src/shared.ts";
import type { Profile } from "../src/shared.ts";

/** A complete profile: male, 35 on 2026-10-03, 180 cm, 80 kg, light activity, losing 0.5 kg a week. */
export function makeProfile(overrides: Partial<ProfileInput> = {}): Profile {
  return ProfileInput.parse({
    sex: "male",
    birth_date: "1991-03-15",
    height_cm: 180,
    weight_kg: 80,
    activity_level: "light",
    goal: "lose",
    goal_rate_kg_week: 0.5,
    ...overrides,
  });
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fitnessai-"));
}

/** A migrated database in a fresh temporary directory. Call `.close()` when done. */
export function openTestDb() {
  return openDatabase({ file: path.join(tempDir(), "fitness.db"), snapshotDir: null });
}
