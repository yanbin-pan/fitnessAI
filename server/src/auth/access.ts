import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { AccessConfig } from "../config.ts";

// Cloudflare Access sends a signed assertion in Cf-Access-Jwt-Assertion. Only the
// signed token is evidence; the plain email header is ignored (spec §13).

export interface Identity {
  email: string;
  /** The owner (OWNER_EMAIL); everyone else on ALLOWED_EMAILS is a guest (2.2 §3). */
  owner: boolean;
}

export interface Verifier {
  verify(token: string): Promise<Identity>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function keySetFor(access: AccessConfig): JWTVerifyGetKey {
  if (access.testJwks) return createLocalJWKSet(JSON.parse(access.testJwks));
  // Handles caching and refetching on an unknown key id, so key rotation is a non-event.
  return createRemoteJWKSet(new URL(`https://${access.teamDomain}/cdn-cgi/access/certs`));
}

export function createVerifier(access: AccessConfig, keys: JWTVerifyGetKey = keySetFor(access)): Verifier {
  const issuer = `https://${access.teamDomain}`;
  return {
    async verify(token) {
      // Checks the signature, issuer, audience and expiry, and refuses a token with no
      // expiry at all. Skipping the issuer would accept a correctly signed token minted
      // for a different Access team.
      const { payload } = await jwtVerify(token, keys, { issuer, audience: access.audience, requiredClaims: ["exp"] });
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!email) throw new AuthError("the token carries no email claim");
      // Even if the Access policy is ever loosened, only the people on the app's own list get in (2.2 F3).
      const owner = email === access.ownerEmail;
      if (!owner && !access.allowedEmails.includes(email)) throw new AuthError("not on the list");
      return { email, owner };
    },
  };
}

/** Local development only (config refuses it outside NODE_ENV=development). */
export function devVerifier(email: string): Verifier {
  return {
    async verify() {
      // The development bypass has one person, and they are the owner.
      return { email, owner: true };
    },
  };
}
