import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, createVerifier, devVerifier } from "../src/auth/access.ts";
import { makeAccess } from "./helpers.ts";

describe("createVerifier", () => {
  it("accepts the owner's token whatever the email's case", async () => {
    const auth = await makeAccess("owner@example.com");
    const identity = await auth.verifier.verify(await auth.token({ email: "Owner@Example.COM" }));
    expect(identity).toEqual({ email: "owner@example.com", owner: true });
  });

  it("lets in a guest on the list, whatever the email's case, as a guest", async () => {
    const auth = await makeAccess("owner@example.com", ["friend@example.com"]);
    const identity = await auth.verifier.verify(await auth.token({ email: " Friend@Example.COM " }));
    expect(identity).toEqual({ email: "friend@example.com", owner: false });
    await expect(auth.verifier.verify(await auth.token({ email: "mum@example.com" }))).rejects.toThrow("not on the list");
  });

  it("rejects anyone not on the list, even with a valid token", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify(await auth.token({ email: "intruder@example.com" }))).rejects.toThrow(AuthError);
    await expect(auth.verifier.verify(await auth.token({ email: null }))).rejects.toThrow(AuthError);
  });

  it("never matches a missing email to a blank owner", async () => {
    const auth = await makeAccess("");
    await expect(auth.verifier.verify(await auth.token({ email: null }))).rejects.toThrow(AuthError);
  });

  it("rejects tokens for another application or team", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify(await auth.token({ aud: "other-aud" }))).rejects.toThrow();
    await expect(auth.verifier.verify(await auth.token({ iss: "https://other.cloudflareaccess.com" }))).rejects.toThrow();
  });

  it("rejects an expired token and one that never expires", async () => {
    const auth = await makeAccess();
    const expired = await auth.token({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(auth.verifier.verify(expired)).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED" });
    await expect(auth.verifier.verify(await auth.token({ exp: null }))).rejects.toMatchObject({ code: "ERR_JWT_CLAIM_VALIDATION_FAILED", claim: "exp" });
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

describe("keySetFor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the team's key set from Cloudflare once and reuses it", async () => {
    const auth = await makeAccess();
    const fetchMock = vi.fn(async () => new Response(auth.access.testJwks));
    vi.stubGlobal("fetch", fetchMock);
    const verifier = createVerifier({ ...auth.access, testJwks: null });
    await expect(verifier.verify(await auth.token())).resolves.toEqual({ email: "owner@example.com", owner: true });
    await expect(verifier.verify(await auth.token())).resolves.toEqual({ email: "owner@example.com", owner: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://test.cloudflareaccess.com/cdn-cgi/access/certs", expect.anything());
  });
});

describe("devVerifier", () => {
  it("treats every request as the configured development user", async () => {
    await expect(devVerifier("dev@localhost").verify("")).resolves.toEqual({ email: "dev@localhost", owner: true });
  });
});
