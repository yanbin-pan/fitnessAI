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

const OPUS_4_AND_5: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
const SONNET_5: Price = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const SONNET_4: Price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

/**
 * Anthropic's list prices on the Claude API, from platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-07),
 * for the dashboard's spend estimate; the bill in the Claude Console is the authority. Every current model is here, not
 * only ANTHROPIC_MODEL: with `fallbacks: "default"` a refused request can be answered by another model, and the usage
 * record names the one that answered. A model missing here is logged and left out of the estimate. Editing a price
 * re-prices everything recorded so far, so the spend panels jump once.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": OPUS_4_AND_5,
  "claude-opus-4-8": OPUS_4_AND_5,
  "claude-opus-4-7": OPUS_4_AND_5,
  "claude-opus-4-6": OPUS_4_AND_5,
  "claude-opus-4-5": OPUS_4_AND_5,
  "claude-sonnet-5-5": SONNET_5,
  "claude-sonnet-5": SONNET_5,
  "claude-sonnet-4-6": SONNET_4,
  "claude-sonnet-4-5": SONNET_4,
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** The table's name for a model: a dated snapshot (`claude-haiku-4-5-20251001`) costs what its alias does. */
function priceOf(model: string): Price | null {
  const alias = model.replace(/-\d{8}$/, "");
  return Object.hasOwn(PRICES, alias) ? PRICES[alias]! : null;
}

/** What these tokens cost at the model's list price, in US dollars; null for a model with no price here. */
export function costDollars(model: string, usage: AiUsage): number | null {
  const price = priceOf(model);
  if (!price) return null;
  const tokenDollars =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_read_input_tokens * price.cacheRead +
    usage.cache_creation_input_tokens * price.cacheWrite;
  return tokenDollars / 1_000_000;
}
