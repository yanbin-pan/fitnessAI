import type { LoopStep } from "./loop.ts";
import { LogItemsInput, UpdateEntryInput } from "./tools.ts";

/** A name as it reads mid-sentence: "Fried eggs" becomes "fried eggs", but "BLT sandwich" and "McFlurry" keep their capitals. */
export function midSentence(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  const acronym = first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first);
  const innerCapital = /[A-Z]/.test(first.slice(1));
  return acronym || innerCapital ? trimmed : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
function listOf(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** What the coach is doing, in the words the phone shows (spec §6.3). Steps never reach the log: they name foods. */
export function stepText(step: LoopStep, photos: number): string {
  if (step.kind === "start") return photos === 0 ? "Thinking…" : photos === 1 ? "Looking at your photo…" : "Looking at your photos…";
  if (step.kind === "reply") return "Writing a reply…";
  if (step.name === "log_items") {
    const parsed = LogItemsInput.safeParse(step.input);
    const names = parsed.success ? [...parsed.data.foods, ...parsed.data.exercises].map((item) => midSentence(item.name)).filter(Boolean) : [];
    return names.length > 0 ? `Logging ${listOf(names)}…` : "Logging…";
  }
  if (step.name === "update_entry") {
    const parsed = UpdateEntryInput.safeParse(step.input);
    const first = parsed.success ? [...parsed.data.foods, ...parsed.data.exercises][0]?.name : undefined;
    return first ? `Updating ${midSentence(first)}…` : "Updating your log…";
  }
  return "Working…";
}
