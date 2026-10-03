import { describe, expect, it, vi } from "vitest";
import { ApiError, api, onSignedOut } from "./api.ts";
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
});
