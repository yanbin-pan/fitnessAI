import type { FastifyReply } from "fastify";
import type { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { openEventStream } from "../src/routes/stream.ts";

/** Just enough of a Fastify reply to see what the stream does with it. */
function fakeReply() {
  const sent: { status: number; headers: Record<string, string>; body: PassThrough | null } = { status: 0, headers: {}, body: null };
  const reply = {
    code(status: number) {
      sent.status = status;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    send(body: PassThrough) {
      sent.body = body;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

describe("openEventStream", () => {
  it("answers 200 as text/event-stream and writes each event as event and data lines", async () => {
    const { reply, sent } = fakeReply();
    const stream = openEventStream(reply, 60_000);
    stream.send("step", { text: "Thinking…" });
    stream.close();
    expect(sent.status).toBe(200);
    expect(sent.headers).toEqual({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
    let written = "";
    for await (const chunk of sent.body as PassThrough) written += String(chunk);
    expect(written).toBe('event: step\ndata: {"text":"Thinking…"}\n\n');
  });

  it("drops what it is given once the phone has gone, without throwing", () => {
    const { reply, sent } = fakeReply();
    const stream = openEventStream(reply, 5);
    sent.body?.destroy();
    expect(() => {
      stream.send("step", { text: "Thinking…" });
      stream.close();
    }).not.toThrow();
  });
});
