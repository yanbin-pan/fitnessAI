import { describe, expect, it, vi } from "vitest";
import { AiError } from "../src/ai/client.ts";
import type { AiClient, AiMessage } from "../src/ai/client.ts";
import { runCoachLoop } from "../src/coach/loop.ts";
import type { LoopInput } from "../src/coach/loop.ts";
import { fakeAi, stopWith, textReply, toolCall } from "./fake-ai.ts";

const userTurn: AiMessage = { role: "user", content: [{ type: "text", text: "2 eggs" }] };
const okOutcome = () => ({ content: '{"ok":true}', isError: false });

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
});
