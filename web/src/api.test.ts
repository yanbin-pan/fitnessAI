import { describe, expect, it, vi } from "vitest";
import { ApiError, api, onSignedOut, responseError } from "./api.ts";
import { jsonResponse, mockFetch } from "./test/render.tsx";

describe("api", () => {
  it("returns the JSON body of a successful response", async () => {
    mockFetch(() => jsonResponse({ ok: true }));
    await expect(api("/api/health")).resolves.toEqual({ ok: true });
  });

  it("sends JSON as a POST and asks to see redirects", async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, 201));
    await api("/api/messages", { json: { text: "hi" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: '{"text":"hi"}', headers: { "content-type": "application/json" } });
  });

  it("posts a blob as the body with its own type", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ id: "x" }, 201));
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    await api("/api/photos", { blob });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/photos");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: blob, headers: { "content-type": "image/jpeg" } });
    // A Blob has no keys of its own, so toMatchObject alone would accept a missing body.
    expect(init?.body).toBe(blob);
  });

  it("treats Cloudflare's sign-in redirect as signed out and tells listeners", async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    mockFetch(() => ({ type: "opaqueredirect", status: 0, ok: false }) as Response);
    await expect(api("/api/days/today")).rejects.toMatchObject({ kind: "signed_out" });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("treats a 401 as signed out", async () => {
    mockFetch(() => new Response(null, { status: 401 }));
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "signed_out" });
  });

  it("reports a network failure as offline, not signed out", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "offline" });
  });

  it("carries the server's error code", async () => {
    mockFetch(() => jsonResponse({ error: "no_profile" }, 409));
    const failure = await api("/api/days/today").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ kind: "http", status: 409, code: "no_profile" });
  });

  it("sends no content-type and no body when there is no JSON (Fastify answers 400 to an empty JSON body)", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: true }));
    await api("/api/messages/m1/retry", { method: "POST" });
    await api("/api/entries/e1", { method: "DELETE" });
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).has("content-type")).toBe(false);
      expect(init?.body).toBeUndefined();
    }
  });

  it("only tells listeners about a signed-out session, never about being offline or an http failure", async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "offline" });
    mockFetch(() => jsonResponse({ error: "no_profile" }, 409));
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "http" });
    expect(listener).not.toHaveBeenCalled();
    mockFetch(() => jsonResponse({ error: "unauthorized" }, 401));
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "signed_out" });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("responseError", () => {
  it("is null for a success, the server's code for a refusal, and signed out for a redirect or a 401", async () => {
    expect(await responseError(new Response("{}", { status: 200 }))).toBeNull();
    expect(await responseError(new Response(JSON.stringify({ error: "too_old" }), { status: 400 }))).toMatchObject({ kind: "http", status: 400, code: "too_old" });
    expect(await responseError(new Response(null, { status: 401 }))).toMatchObject({ kind: "signed_out" });
    expect(await responseError(new Response(null, { status: 302 }))).toMatchObject({ kind: "signed_out" });
  });
});
