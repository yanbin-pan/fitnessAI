import { describe, expect, it, vi } from "vitest";
import { AiError } from "../src/ai/client.ts";
import type { AiClient, AiContentBlock, AiMessage } from "../src/ai/client.ts";
import { runCoachLoop } from "../src/coach/loop.ts";
import type { LoopInput, LoopStep } from "../src/coach/loop.ts";
import { fakeAi, stopWith, textReply, toolCall } from "./fake-ai.ts";

const userTurn: AiMessage = { role: "user", content: [{ type: "text", text: "2 eggs" }] };
const okOutcome = () => ({ content: '{"ok":true}', isError: false });
const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function input(ai: AiClient, overrides: Partial<LoopInput> = {}): LoopInput {
  return {
    ai, system: "system", tools: [], history: [], userTurn, execute: vi.fn(okOutcome),
    signal: new AbortController().signal, maxCalls: 5, ...overrides,
  };
}

describe("runCoachLoop", () => {
  it("returns the reply when Claude answers without tools", async () => {
    const result = await runCoachLoop(input(fakeAi([textReply("Hello")])));
    expect(result).toMatchObject({ ok: true, replyText: "Hello", calls: 1 });
    expect(result.ok && result.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("runs the tools Claude asks for and sends the results back", async () => {
    const ai = fakeAi([toolCall([{ name: "log_items", input: { a: 1 } }]), textReply("Logged.")]);
    const execute = vi.fn(okOutcome);
    const result = await runCoachLoop(input(ai, { execute }));
    expect(execute).toHaveBeenCalledWith("log_items", { a: 1 });
    expect(result).toMatchObject({ ok: true, replyText: "Logged.", calls: 2 });
    expect(result.ok && result.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(ai.requests[1].messages[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", content: '{"ok":true}', is_error: false }],
    });
  });

  it("passes tool errors back so Claude can correct itself", async () => {
    const ai = fakeAi([toolCall([{ name: "log_items", input: {} }]), textReply("Fixed.")]);
    await runCoachLoop(input(ai, { execute: () => ({ content: '{"ok":false}', isError: true }) }));
    expect(ai.requests[1].messages[2]).toMatchObject({ content: [{ type: "tool_result", is_error: true }] });
  });

  it("sends the day's history before the new turn", async () => {
    const history: AiMessage[] = [
      { role: "user", content: [{ type: "text", text: "earlier" }] },
      { role: "assistant", content: [{ type: "text", text: "noted" }] },
    ];
    const ai = fakeAi([textReply("Hi")]);
    await runCoachLoop(input(ai, { history }));
    expect(ai.requests[0].messages).toEqual([...history, userTurn]);
  });

  it("stops on a refusal or a cut-off reply", async () => {
    expect(await runCoachLoop(input(fakeAi([stopWith("refusal")])))).toMatchObject({ ok: false, failure: "refused" });
    expect(await runCoachLoop(input(fakeAi([stopWith("max_tokens")])))).toMatchObject({ ok: false, failure: "max_tokens" });
  });

  it("maps AI errors to failures", async () => {
    expect(await runCoachLoop(input(fakeAi([new AiError("timeout", "slow")])))).toMatchObject({ ok: false, failure: "timeout" });
    expect(await runCoachLoop(input(fakeAi([new AiError("rate_limited", "busy")])))).toMatchObject({ ok: false, failure: "ai_rate_limited" });
    expect(await runCoachLoop(input(fakeAi([new AiError("api_error", "boom")])))).toMatchObject({ ok: false, failure: "ai_error" });
  });

  it("keeps Claude's error text for the log", async () => {
    const result = await runCoachLoop(input(fakeAi([new AiError("api_error", "400 invalid_request_error: fallbacks")])));
    expect(result).toMatchObject({ ok: false, failure: "ai_error", detail: "400 invalid_request_error: fallbacks" });
  });

  it("gives up after the call limit", async () => {
    const loop = () => toolCall([{ name: "log_items", input: {} }]);
    const result = await runCoachLoop(input(fakeAi([loop(), loop(), loop()]), { maxCalls: 3 }));
    expect(result).toMatchObject({ ok: false, failure: "tool_loop_limit", calls: 3 });
  });

  it("adds up token usage across calls", async () => {
    const result = await runCoachLoop(input(fakeAi([toolCall([{ name: "log_items", input: {} }]), textReply("ok")])));
    expect(result.usage).toMatchObject({ input_tokens: 200, output_tokens: 40 });
  });

  it("rethrows unexpected errors instead of hiding bugs", async () => {
    const ai = fakeAi([() => {
      throw new Error("bug");
    }]);
    await expect(runCoachLoop(input(ai))).rejects.toThrow("bug");
  });

  it("echoes every block of an assistant turn unchanged, in the turn and in the next request", async () => {
    const content = [
      { type: "thinking", thinking: "hmm", signature: "sig==" },
      { type: "text", text: "partial", citations: null },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-sonnet-5-5" }, trigger: { type: "refusal", category: null } },
      { type: "redacted_thinking", data: "opaque" },
      { type: "text", text: "Logging.", citations: null },
      { type: "tool_use", id: "toolu_d", name: "log_items", input: { a: 1 } },
    ] as unknown as AiContentBlock[];
    const snapshot = structuredClone(content);
    const ai = fakeAi([{ content, stop_reason: "tool_use", model: "claude-opus-5-5", usage: USAGE }, textReply("ok")]);
    const result = await runCoachLoop(input(ai));
    expect(result.ok && result.turns[1].content).toEqual(snapshot);
    expect(ai.requests[1].messages[1].content).toEqual(snapshot);
    expect(content).toEqual(snapshot);
  });

  it("answers several tool calls in one user turn, in order, each paired with its call", async () => {
    const calling = toolCall([{ name: "log_items", input: { n: 1 } }, { name: "update_entry", input: { n: 2 } }], "Working.");
    const [first, second] = calling.content.filter((b) => b.type === "tool_use") as unknown as { id: string }[];
    const ai = fakeAi([calling, textReply("ok")]);
    const outcomes = [{ content: "first", isError: false }, { content: "second", isError: true }];
    let i = 0;
    const result = await runCoachLoop(input(ai, { execute: () => outcomes[i++] }));
    expect(ai.requests[1].messages).toHaveLength(3);
    expect(ai.requests[1].messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: first.id, content: "first", is_error: false },
        { type: "tool_result", tool_use_id: second.id, content: "second", is_error: true },
      ],
    });
    expect(result).toMatchObject({ ok: true, replyText: "Working.\n\nok" });
  });

  it("runs a tool even when its turn ends with end_turn", async () => {
    const ai = fakeAi([{ ...toolCall([{ name: "log_items", input: { a: 1 } }], "On it."), stop_reason: "end_turn" }, textReply("Done.")]);
    const execute = vi.fn(okOutcome);
    const result = await runCoachLoop(input(ai, { execute }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, replyText: "On it.\n\nDone.", calls: 2 });
  });

  it("counts the tokens of a refused call", async () => {
    const result = await runCoachLoop(input(fakeAi([toolCall([{ name: "log_items", input: {} }]), stopWith("refusal")])));
    expect(result).toMatchObject({ ok: false, failure: "refused", usage: { input_tokens: 200, output_tokens: 40 } });
  });

  it("fails an empty reply instead of storing an empty turn", async () => {
    expect(await runCoachLoop(input(fakeAi([stopWith("end_turn")])))).toMatchObject({ ok: false, failure: "ai_error" });
    const afterTool = await runCoachLoop(input(fakeAi([toolCall([{ name: "log_items", input: {} }]), stopWith("end_turn")])));
    expect(afterTool).toMatchObject({ ok: false, failure: "ai_error", calls: 2 });
    const thinkingOnly = {
      content: [{ type: "thinking", thinking: "hmm", signature: "s" }] as unknown as AiContentBlock[],
      stop_reason: "end_turn", model: "claude-opus-5-5", usage: USAGE,
    };
    expect(await runCoachLoop(input(fakeAi([thinkingOnly])))).toMatchObject({ ok: false, failure: "ai_error" });
  });

  it("treats a reply cut off by the context window like one cut off by max_tokens", async () => {
    expect(await runCoachLoop(input(fakeAi([stopWith("model_context_window_exceeded")])))).toMatchObject({ ok: false, failure: "max_tokens" });
  });

  it("says what it is about to do: its first look, each tool, then the reply after the tools", async () => {
    const steps: LoopStep[] = [];
    const ai = fakeAi([toolCall([{ name: "log_items", input: { a: 1 } }, { name: "update_entry", input: { b: 2 } }]), textReply("Logged.")]);
    await runCoachLoop(input(ai, { onStep: (step) => steps.push(step) }));
    expect(steps).toEqual([
      { kind: "start" },
      { kind: "tool", name: "log_items", input: { a: 1 } },
      { kind: "tool", name: "update_entry", input: { b: 2 } },
      { kind: "reply" },
    ]);
  });
});
