import type Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../ai/client.ts";
import type { AiClient, AiMessage, AiResponse, AiTool, AiUsage } from "../ai/client.ts";
import type { ToolOutcome } from "./staging.ts";

export type CoachFailure = "timeout" | "ai_error" | "ai_rate_limited" | "refused" | "max_tokens" | "tool_loop_limit";

export interface LoopInput {
  ai: AiClient;
  system: string;
  tools: AiTool[];
  /** Earlier turns of the day, replayed unchanged. */
  history: AiMessage[];
  userTurn: AiMessage;
  execute: (name: string, input: unknown) => ToolOutcome;
  signal: AbortSignal;
  maxCalls: number;
}

export type LoopResult =
  | { ok: true; turns: AiMessage[]; replyText: string; calls: number; usage: AiUsage }
  | { ok: false; failure: CoachFailure; calls: number; usage: AiUsage };

function failureFor(err: AiError): CoachFailure {
  if (err.code === "timeout") return "timeout";
  if (err.code === "rate_limited") return "ai_rate_limited";
  return "ai_error";
}

export async function runCoachLoop(input: LoopInput): Promise<LoopResult> {
  const turns: AiMessage[] = [input.userTurn];
  const usage: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const texts: string[] = [];
  let calls = 0;

  while (calls < input.maxCalls) {
    calls += 1;
    let response: AiResponse;
    try {
      response = await input.ai.complete(
        { system: input.system, tools: input.tools, messages: [...input.history, ...turns] },
        input.signal,
      );
    } catch (err) {
      if (err instanceof AiError) return { ok: false, failure: failureFor(err), calls, usage };
      throw err;
    }
    for (const key of Object.keys(usage) as (keyof AiUsage)[]) usage[key] += response.usage[key];

    // A refusal can cut a tool call off mid-input: never run that turn's tools.
    if (response.stop_reason === "refusal") return { ok: false, failure: "refused", calls, usage };
    if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") {
      return { ok: false, failure: "max_tokens", calls, usage };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const replyTexts = response.content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []));
    // A turn with neither text nor a tool call gives the owner nothing to read, and an empty
    // assistant turn replayed later would make every remaining message of the day fail.
    if (toolUses.length === 0 && replyTexts.length === 0) return { ok: false, failure: "ai_error", calls, usage };

    // Echo the content back exactly as it came: thinking blocks must be replayed unchanged.
    turns.push({ role: "assistant", content: response.content });
    texts.push(...replyTexts);
    if (toolUses.length === 0) return { ok: true, turns, replyText: texts.join("\n\n"), calls, usage };

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      const outcome = input.execute(use.name, use.input);
      return { type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
    });
    turns.push({ role: "user", content: results });
  }
  return { ok: false, failure: "tool_loop_limit", calls, usage };
}
