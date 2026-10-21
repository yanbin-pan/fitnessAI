// The companion's reactions to the person's chat bubble (2026-10-21), like a tapback. Most cheer, a few raise an
// eyebrow at a plan that is not so great. The coach picks one inside its reply, so a reaction costs no extra call.

export const CHEER_REACTIONS = ["👍", "❤️", "🙌", "💪", "🔥", "👏", "🎉", "😋"] as const;
export const DOUBT_REACTIONS = ["🤔", "😬", "👀", "🫣"] as const;
export const REACTIONS = [...CHEER_REACTIONS, ...DOUBT_REACTIONS] as const;
export type Reaction = (typeof REACTIONS)[number];

// Emoji arrive with or without the variation selector (❤ or ❤️), so compare without it.
const bare = (emoji: string) => emoji.replaceAll("️", "");
const BY_BARE = new Map<string, Reaction>(REACTIONS.map((r) => [bare(r), r]));

/** The reaction an emoji names, or null for one outside the list. */
export function asReaction(emoji: string): Reaction | null {
  return BY_BARE.get(bare(emoji.trim())) ?? null;
}

const TAG = /^\s*\[react:\s*([^\]\s]{1,16})\s*\]\s*/u;

/**
 * Splits the coach's reaction tag off the start of a reply text: "[react:👍] Logged…" gives 👍 and "Logged…". A tag
 * with an emoji outside the list is still taken off, so the person never sees it; it just gives no reaction.
 */
export function splitReaction(text: string): { reaction: Reaction | null; text: string } {
  const match = TAG.exec(text);
  if (!match) return { reaction: null, text };
  return { reaction: asReaction(match[1]), text: text.slice(match[0].length) };
}
