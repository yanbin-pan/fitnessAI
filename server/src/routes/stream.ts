import { PassThrough } from "node:stream";
import type { FastifyReply } from "fastify";
import type { CoachStreamEvents } from "../shared.ts";

export interface EventStream {
  send<K extends keyof CoachStreamEvents>(event: K, data: CoachStreamEvents[K]): void;
  close(): void;
}

/**
 * Answers with text/event-stream (spec §6.3) and returns the means to write to it. no-transform keeps
 * Cloudflare from holding events back. Anything written after the phone has gone is dropped: the work
 * behind a stream never depends on someone still listening.
 */
export function openEventStream(reply: FastifyReply, keepAliveMs: number): EventStream {
  const body = new PassThrough();
  // A connection that closes mid-write is expected, not a crash.
  body.on("error", () => {});
  const write = (chunk: string) => {
    if (!body.destroyed && !body.writableEnded) body.write(chunk);
  };
  const timer = setInterval(() => write(": keep-alive\n\n"), keepAliveMs);
  reply
    .code(200)
    .header("content-type", "text/event-stream; charset=utf-8")
    .header("cache-control", "no-cache, no-transform")
    .header("x-accel-buffering", "no");
  void reply.send(body);
  return {
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => {
      clearInterval(timer);
      if (!body.destroyed && !body.writableEnded) body.end();
    },
  };
}
