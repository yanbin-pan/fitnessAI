import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../config.ts";
import { AiError } from "./client.ts";
import type { AiClient, AiRequest } from "./client.ts";

/**
 * server-side-fallback: a classifier refusal is retried on Anthropic's recommended
 * model inside the same call (spec §6.4).
 * thinking-binding-controls: lets us ask for "drop_block" so a deploy that changes
 * the tools or system prompt mid-day degrades instead of failing with a 400.
 */
export const COACH_BETAS = ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"];

export function buildRequest(model: string, effort: Effort, request: AiRequest): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16000, // thinking counts toward this, so leave room beyond the short reply
    betas: COACH_BETAS,
    fallbacks: "default",
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort },
    cache_control: { type: "ephemeral" }, // caches the growing thread
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    tools: request.tools,
    messages: request.messages,
  };
}

export function toAiError(err: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("timeout", "Claude did not answer in time");
  }
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limited", err.message);
  if (err instanceof Anthropic.APIError) return new AiError("api_error", err.message);
  return err;
}

export function anthropicClient(opts: {
  apiKey: string;
  model: string;
  effort: Effort;
  maxRetries?: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}): AiClient {
  // logLevel "off": the SDK must never log request bodies (spec §13), whatever ANTHROPIC_LOG says.
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 1, timeout: 60_000, fetch: opts.fetch, logLevel: "off" });
  return {
    async complete(request, signal) {
      try {
        const message = await client.beta.messages.create(buildRequest(opts.model, opts.effort, request), { signal });
        return {
          content: message.content,
          stop_reason: message.stop_reason,
          model: message.model,
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (err) {
        throw toAiError(err, signal);
      }
    },
  };
}
