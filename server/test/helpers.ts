import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/db/open.ts";
import { ProfileInput } from "../src/shared.ts";
import type { Profile } from "../src/shared.ts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createVerifier } from "../src/auth/access.ts";
import type { AccessConfig } from "../src/config.ts";
import { buildApp } from "../src/app.ts";
import type { ExerciseItemData, FoodItemData, NewEntry } from "../src/log/entries.ts";
import type { AiClient } from "../src/ai/client.ts";
import type { Metrics } from "../src/metrics.ts";

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

export interface TokenClaims {
  /** `null` leaves the claim out entirely. */
  email?: string | null;
  aud?: string;
  iss?: string;
  /** `null` leaves the claim out entirely. */
  exp?: string | number | null;
}

/** A local Access stand-in: a key pair, the matching config, and a token minter. */
export async function makeAccess(ownerEmail = "owner@example.com", allowedEmails: string[] = []) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const access: AccessConfig = {
    teamDomain: "test.cloudflareaccess.com",
    audience: "test-aud",
    ownerEmail,
    allowedEmails,
    testJwks: JSON.stringify({ keys: [jwk] }),
  };
  async function token(claims: TokenClaims = {}): Promise<string> {
    const email = claims.email === undefined ? ownerEmail : claims.email;
    const jwt = new SignJWT(email === null ? {} : { email })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(claims.iss ?? `https://${access.teamDomain}`)
      .setAudience(claims.aud ?? access.audience)
      .setIssuedAt();
    if (claims.exp !== null) jwt.setExpirationTime(claims.exp ?? "5m");
    return jwt.sign(privateKey);
  }
  return { access, token, verifier: createVerifier(access) };
}

/** The clock every test app uses: 13:00 BST on Saturday 3 October 2026. */
export const NOW = new Date("2026-10-03T12:00:00.000Z");

export async function testApp(opts: { now?: Date; webDist?: string | null; ai?: AiClient | null; coachBudgetMs?: number; metrics?: Metrics; streamKeepAliveMs?: number; logLines?: string[] } = {}) {
  const auth = await makeAccess();
  const database = openTestDb();
  const photoDir = tempDir();
  const app = buildApp({
    db: database.db,
    verifier: auth.verifier,
    now: () => opts.now ?? NOW,
    webDist: opts.webDist ?? null,
    photoDir,
    ai: opts.ai ?? null,
    coachBudgetMs: opts.coachBudgetMs ?? 90_000,
    metrics: opts.metrics,
    streamKeepAliveMs: opts.streamKeepAliveMs,
    logger: opts.logLines !== undefined,
    logStream: opts.logLines ? { write: (line: string) => void opts.logLines?.push(line) } : undefined,
  });
  await app.ready();
  const owner = await auth.token();
  return {
    app,
    db: database.db,
    photoDir,
    auth,
    headers: { "cf-access-jwt-assertion": owner },
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;

export function sampleFood(overrides: Partial<FoodItemData> = {}): FoodItemData {
  return {
    name: "Eggs", quantity: "2 large", grams: 120, kcal: 156, protein_g: 13, carbs_g: 1, fat_g: 11, fibre_g: 0,
    saturated_fat_g: 3.3, sugars_g: 0.4, salt_g: 0.4, fluid_ml: 0, alcohol_units: 0,
    assumption: "", saved_food_id: null, groups: [], ...overrides,
  };
}

export function sampleExercise(overrides: Partial<ExerciseItemData> = {}): ExerciseItemData {
  return {
    name: "Run", category: "cardio", activity: "other", duration_min: 30, sets: null, reps: null, weight_kg: null,
    distance_km: 5, avg_hr: null, met: 9, kcal: 320, kcal_measured: false, assumption: "",
    muscles: [{ muscle: "quads", role: "primary" }], ...overrides,
  };
}

export function sampleEntry(overrides: Partial<NewEntry> = {}): NewEntry {
  return {
    id: randomUUID(), date: "2026-10-03", logged_at: "2026-10-03T07:00:00.000Z", source: "manual",
    message_id: null, foods: [sampleFood()], exercises: [], ...overrides,
  };
}

/** A complete food item as Claude sends it to log_items. */
export const TOOL_EGGS = {
  name: "Scrambled eggs", quantity: "2 eggs", grams: 120, kcal: 180, protein_g: 13, carbs_g: 1, fat_g: 14,
  fibre_g: 0, saturated_fat_g: 4, sugars_g: 0.5, salt_g: 0.5, fluid_ml: 0, alcohol_units: 0,
  groups: [], assumption: "cooked with a little butter",
};

/** A complete exercise item as Claude sends it: 30 minutes at MET 9 is 320 active kcal at 80 kg. */
export const TOOL_RUN = {
  name: "Run", category: "cardio", activity: "other", duration_min: 30, met: 9, sets: null, reps: null, weight_kg: null,
  distance_km: 5, muscles: [{ muscle: "quads", role: "primary" }], assumption: "steady pace",
};

export function logItemsInput(overrides: Record<string, unknown> = {}) {
  return { date: null, time: null, foods: [TOOL_EGGS], exercises: [], ...overrides };
}
