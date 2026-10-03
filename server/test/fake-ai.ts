import { AiError } from "../src/ai/client.ts";
import type { AiClient, AiContentBlock, AiRequest, AiResponse } from "../src/ai/client.ts";

// A scripted stand-in for Claude: each call takes the next step. Tests never touch the network.

export type FakeStep = AiResponse | AiError | ((request: AiRequest, signal: AbortSignal) => AiResponse | Promise<AiResponse>);

export interface FakeAi extends AiClient {
  requests: AiRequest[];
}

export function fakeAi(steps: FakeStep[]): FakeAi {
  const requests: AiRequest[] = [];
  let next = 0;
  return {
    requests,
    async complete(request, signal) {
      requests.push(structuredClone(request));
      const step = steps[next++];
      if (step === undefined) throw new Error(`fakeAi: no scripted response for call ${next}`);
      if (step instanceof AiError) throw step;
      return typeof step === "function" ? step(request, signal) : step;
    },
  };
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let toolIds = 0;

function block(value: Record<string, unknown>): AiContentBlock {
  return value as unknown as AiContentBlock;
}

export function textReply(text: string): AiResponse {
  return { content: [block({ type: "text", text, citations: null })], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
}

export function toolCall(calls: { name: string; input: unknown }[], text = ""): AiResponse {
  const content: AiContentBlock[] = text ? [block({ type: "text", text, citations: null })] : [];
  for (const call of calls) content.push(block({ type: "tool_use", id: `toolu_${++toolIds}`, name: call.name, input: call.input }));
  return { content, stop_reason: "tool_use", model: "claude-opus-5-5", usage };
}

export function stopWith(reason: "refusal" | "max_tokens"): AiResponse {
  return { content: [], stop_reason: reason, model: "claude-opus-5-5", usage };
}

/** A call that only ends when the coach's time budget aborts it. */
export function hangUntilAborted(): FakeStep {
  return (_request, signal) =>
    new Promise<AiResponse>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new AiError("timeout", "aborted")));
    });
}
