import { addDays } from "./dates.ts";
import type { Drink } from "./vocab.ts";

// Alcohol on Today (2026-10-08 alcohol design): a badge per kind of drink had on the day, the drinks' share of the
// calories and macros drawn striped, and the units of the 7 days ending on the day against the UK weekly guide.

/** The UK Chief Medical Officers' low-risk guide: no more than 14 units a week. */
export const ALCOHOL_WEEK_GUIDE = 14;
/** From here up to the guide the week reads as close to it. */
export const ALCOHOL_WEEK_NEAR = 10.5;
export const ALCOHOL_WINDOW_DAYS = 7;
/** A UK unit is 8 g of alcohol, at 7 kcal a gram. */
export const KCAL_PER_UNIT = 56;

export type AlcoholStatus = "within" | "near" | "over";

/** A drink kind's share of the week; `drink` is null for drinks with alcohol but no kind (logged before kinds existed). */
export interface DrinkTotal {
  drink: Drink | null;
  /** Drinks logged: the coach logs each drink as an item of its own. */
  count: number;
  units: number;
  kcal: number;
}

/** The alcohol of the 7 days ending on a day (2026-10-08 alcohol design §3). */
export interface AlcoholWeek {
  units: number;
  status: AlcoholStatus;
  /** The 7 days, oldest first, the last being the day itself. */
  days: { date: string; units: number }[];
  alcohol_free_days: number;
  /** By kind, beer, wine and cocktails first, then drinks of no kind. */
  drinks: DrinkTotal[];
}

/** What a food item needs for this: whether it is an alcoholic drink, and how much. */
export interface DrinkLike {
  drink?: Drink | null;
  alcohol_units: number;
  kcal: number;
}

/** A drink of a known kind, or anything with alcohol in it. */
export function isDrink(food: DrinkLike): boolean {
  return (food.drink ?? null) !== null || food.alcohol_units > 0;
}

export function alcoholStatus(units: number): AlcoholStatus {
  if (units > ALCOHOL_WEEK_GUIDE) return "over";
  return units >= ALCOHOL_WEEK_NEAR ? "near" : "within";
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The week ending on `end` from each day's food items (`foodsOn(date)`); null when none of its days has a drink.
 * Units are rounded to one decimal place, as the app shows them.
 */
export function alcoholWeek(end: string, foodsOn: (date: string) => readonly DrinkLike[]): AlcoholWeek | null {
  const days: { date: string; units: number }[] = [];
  const kinds = new Map<Drink | null, DrinkTotal>();
  let any = false;
  for (let back = ALCOHOL_WINDOW_DAYS - 1; back >= 0; back--) {
    const date = addDays(end, -back);
    let units = 0;
    for (const food of foodsOn(date)) {
      if (!isDrink(food)) continue;
      any = true;
      units += food.alcohol_units;
      const drink = food.drink ?? null;
      const total = kinds.get(drink) ?? { drink, count: 0, units: 0, kcal: 0 };
      total.count += 1;
      total.units += food.alcohol_units;
      total.kcal += food.kcal;
      kinds.set(drink, total);
    }
    days.push({ date, units: round1(units) });
  }
  if (!any) return null;
  const units = round1(days.reduce((sum, day) => sum + day.units, 0));
  const order = (drink: Drink | null) => (drink === null ? 99 : ["beer", "wine", "cocktail"].indexOf(drink));
  return {
    units,
    status: alcoholStatus(units),
    days,
    alcohol_free_days: days.filter((day) => day.units === 0).length,
    drinks: [...kinds.values()]
      .sort((a, b) => order(a.drink) - order(b.drink))
      .map((total) => ({ ...total, units: round1(total.units), kcal: Math.round(total.kcal) })),
  };
}
