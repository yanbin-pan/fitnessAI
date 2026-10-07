import type { AiUsage } from "./client.ts";

/** One model's list prices, in US dollars per million tokens. */
export interface Price {
  input: number;
  output: number;
  /** Cache hits and refreshes. */
  cacheRead: number;
  /** 5-minute cache writes: the app never asks for the 1-hour TTL (ai/anthropic.ts). */
  cacheWrite: number;
}

/**
 * Anthropic's list prices on the Claude API, from platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-07),
 * for the dashboard's spend estimate. The bill in the Claude Console is the authority. Add a model here before
 * ANTHROPIC_MODEL names it: one with no price is logged and left out of the estimate.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** What these tokens cost at the model's list price, in US dollars; null for a model with no price here. */
export function costDollars(model: string, usage: AiUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const perMillion =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_read_input_tokens * price.cacheRead +
    usage.cache_creation_input_tokens * price.cacheWrite;
  return perMillion / 1_000_000;
}
