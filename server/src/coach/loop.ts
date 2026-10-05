import type Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../ai/client.ts";
import type { AiClient, AiMessage, AiResponse, AiTool, AiUsage } from "../ai/client.ts";
import type { ToolOutcome } from "./staging.ts";

export type CoachFailure = "timeout" | "ai_error" | "ai_rate_limited" | "refused" | "max_tokens" | "tool_loop_limit";

/** What the coach is about to do (spec §6.3): its first look, a tool, or a reply once tools have run. */
export type LoopStep = { kind: "start" } | { kind: "tool"; name: string; input: unknown } | { kind: "reply" };

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
  /** Told before each model call and each tool, for the live steps. */
  onStep?: (step: LoopStep) => void;
}

export type LoopResult =
  | { ok: true; turns: AiMessage[]; replyText: string; calls: number; usage: AiUsage; model: string | null }
  | { ok: false; failure: CoachFailure; calls: number; usage: AiUsage; model: string | null; detail?: string };

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
  let model: string | null = null;

  while (calls < input.maxCalls) {
    calls += 1;
    input.onStep?.(calls === 1 ? { kind: "start" } : { kind: "reply" });
    let response: AiResponse;
    try {
      response = await input.ai.complete(
        { system: input.system, tools: input.tools, messages: [...input.history, ...turns] },
        input.signal,
      );
    } catch (err) {
      if (err instanceof AiError) return { ok: false, failure: failureFor(err), calls, usage, model, detail: err.message };
      throw err;
    }
    for (const key of Object.keys(usage) as (keyof AiUsage)[]) usage[key] += response.usage[key];
    model = response.model;

    // A refusal can cut a tool call off mid-input: never run that turn's tools.
    if (response.stop_reason === "refusal") return { ok: false, failure: "refused", calls, usage, model };
    if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") {
      return { ok: false, failure: "max_tokens", calls, usage, model };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const replyTexts = response.content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []));
    // A turn with neither text nor a tool call gives the owner nothing to read, and an empty
    // assistant turn replayed later would make every remaining message of the day fail.
    if (toolUses.length === 0 && replyTexts.length === 0) {
      return { ok: false, failure: "ai_error", calls, usage, model, detail: "the reply had no text and no tool call" };
    }

    // Echo the content back exactly as it came: thinking blocks must be replayed unchanged.
    turns.push({ role: "assistant", content: response.content });
    texts.push(...replyTexts);
    if (toolUses.length === 0) return { ok: true, turns, replyText: texts.join("\n\n"), calls, usage, model };

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      input.onStep?.({ kind: "tool", name: use.name, input: use.input });
      const outcome = input.execute(use.name, use.input);
      return { type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
    });
    turns.push({ role: "user", content: results });
  }
  return { ok: false, failure: "tool_loop_limit", calls, usage, model };
}
