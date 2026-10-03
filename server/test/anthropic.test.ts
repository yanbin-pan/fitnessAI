import { describe, expect, it } from "vitest";
import { anthropicClient, buildRequest, toAiError } from "../src/ai/anthropic.ts";
import { AiError } from "../src/ai/client.ts";
import type { AiRequest } from "../src/ai/client.ts";

const request: AiRequest = { system: "You are a coach.", tools: [], messages: [{ role: "user", content: "2 eggs" }] };

function fakeFetch(status: number, body: unknown, seen: { init?: RequestInit; url?: string } = {}) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

const OK_REPLY = {
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
  content: [{ type: "text", text: "Logged.", citations: null }],
  stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: null },
};

describe("buildRequest", () => {
  it("turns on fallbacks, tolerant thinking binding, caching and the chosen effort", () => {
    expect(buildRequest("claude-opus-5-5", "medium", request)).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: "You are a coach.", cache_control: { type: "ephemeral" } }],
    });
  });
});

describe("anthropicClient", () => {
  it("sends the betas as a header and maps the reply", async () => {
    const seen: { init?: RequestInit; url?: string } = {};
    const client = anthropicClient({ apiKey: "test-key", model: "claude-opus-5-5", effort: "medium", maxRetries: 0, fetch: fakeFetch(200, OK_REPLY, seen) });
    const result = await client.complete(request, new AbortController().signal);
    expect(result).toMatchObject({
      stop_reason: "end_turn",
      model: "claude-opus-5-5",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
    });
    expect(seen.url).toContain("/v1/messages");
    const beta = new Headers(seen.init?.headers).get("anthropic-beta");
    expect(beta).toContain("server-side-fallback-2026-07-01");
    expect(beta).toContain("thinking-binding-controls-2026-08-01");
    const sent = JSON.parse(String(seen.init?.body));
    expect(sent).toMatchObject({ fallbacks: "default", output_config: { effort: "medium" }, max_tokens: 16000, tools: [], messages: request.messages });
    expect(sent).not.toHaveProperty("tool_choice");
    expect(result.content).toEqual(OK_REPLY.content);
  });

  it("reports a rate limit as AiError rate_limited", async () => {
    const body = { type: "error", error: { type: "rate_limit_error", message: "slow down" } };
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch: fakeFetch(429, body) });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({ name: "AiError", code: "rate_limited" });
  });

  it("reports other API failures as AiError api_error", async () => {
    const body = { type: "error", error: { type: "api_error", message: "boom" } };
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch: fakeFetch(500, body) });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({ code: "api_error" });
  });

  it("reports an aborted call as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch: fakeFetch(200, OK_REPLY) });
    const failure = await client.complete(request, controller.signal).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AiError);
    expect(failure).toMatchObject({ code: "timeout" });
  });

  it("reports the SDK's own request timeout as a timeout", async () => {
    const fetch = async (): Promise<Response> => {
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({ name: "AiError", code: "timeout" });
  });
});

describe("toAiError", () => {
  it("passes unexpected errors through untouched", () => {
    const bug = new TypeError("bug");
    expect(toAiError(bug, new AbortController().signal)).toBe(bug);
  });
});
