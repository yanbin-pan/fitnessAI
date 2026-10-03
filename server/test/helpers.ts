import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/open.ts";
import { ProfileInput } from "../src/shared.ts";
import type { Profile } from "../src/shared.ts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createVerifier } from "../src/auth/access.ts";
import type { AccessConfig } from "../src/config.ts";

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
export async function makeAccess(ownerEmail = "owner@example.com") {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const access: AccessConfig = {
    teamDomain: "test.cloudflareaccess.com",
    audience: "test-aud",
    ownerEmail,
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
