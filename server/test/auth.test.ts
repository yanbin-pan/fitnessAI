import { describe, expect, it } from "vitest";
import { devVerifier } from "../src/auth/access.ts";
import { makeAccess } from "./helpers.ts";

describe("createVerifier", () => {
  it("accepts the owner's token whatever the email's case", async () => {
    const auth = await makeAccess("owner@example.com");
    const identity = await auth.verifier.verify(await auth.token({ email: "Owner@Example.COM" }));
    expect(identity).toEqual({ email: "owner@example.com" });
  });

  it("rejects anyone who is not the owner, even with a valid token", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify(await auth.token({ email: "intruder@example.com" }))).rejects.toThrow();
    await expect(auth.verifier.verify(await auth.token({ email: null }))).rejects.toThrow();
  });

  it("rejects tokens for another application or team", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify(await auth.token({ aud: "other-aud" }))).rejects.toThrow();
    await expect(auth.verifier.verify(await auth.token({ iss: "https://other.cloudflareaccess.com" }))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const auth = await makeAccess();
    const expired = await auth.token({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(auth.verifier.verify(expired)).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    const auth = await makeAccess();
    const impostor = await makeAccess();
    await expect(auth.verifier.verify(await impostor.token())).rejects.toThrow();
  });

  it("rejects a missing or malformed token", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify("")).rejects.toThrow();
    await expect(auth.verifier.verify("not.a.jwt")).rejects.toThrow();
  });
});

describe("devVerifier", () => {
  it("treats every request as the configured development user", async () => {
    await expect(devVerifier("dev@localhost").verify("")).resolves.toEqual({ email: "dev@localhost" });
  });
});
