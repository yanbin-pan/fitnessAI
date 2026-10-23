import { thousands } from "../format.ts";
import type { Messages } from "../i18n/index.tsx";
import type { SeenTip, TipId } from "../shared.ts";

/** What a tip says, with the day's numbers it was shown with (2026-10-23 pet tips design). */
export function tipText(tip: SeenTip, t: Messages): string {
  if (tip.id === "close-day") return t.tips.closeDay(thousands(tip.vars.kcal ?? 0, t), thousands(tip.vars.protein_g ?? 0, t));
  if (tip.id === "vitamin-gaps") {
    const names = (tip.vars.nutrients ?? []).map((nutrient) => t.nutrients.names[nutrient]);
    return t.tips.vitaminGaps(new Intl.ListFormat(t.locale, { type: "conjunction" }).format(names), names.length);
  }
  return t.tips.items[tip.id];
}

/** The question a tip suggests, for its Try it chip; most tips have none. */
export function tipAsk(id: TipId, t: Messages): string | undefined {
  return (t.tips.asks as Partial<Record<TipId, string>>)[id];
}
