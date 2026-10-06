# Vitamins, fats and sugar — design

A calm view of fats, sugar, salt, vitamins and minerals: a word for each, never a number against a target. The app
should nudge, not keep score.

## 1. Data

- The coach estimates 11 vitamins and minerals per food (`MICROS` in `shared/src/vocab.ts`: vitamins A, C, D, E, B12,
  folate; calcium, iron, magnesium, potassium, zinc), each in the unit its name ends in, from typical food-composition
  values. They travel as a list of `{nutrient, amount}`, like food groups: `log_items` is the strict tool and its grammar
  has a size limit, so a compact list (+13 % schema) rather than eleven fields.
- Stored in `food_items.micros` (JSON; migration `0006_food_micros`). Null when nobody estimated them (typed in by hand,
  or logged before this); the manual editor keeps an existing estimate when a portion is edited.
- Unsaturated fat is total fat minus saturated: nothing new to estimate.

## 2. Signals (`shared/src/nutrients.ts`)

Over the last 7 complete days (viewing today: the 7 before it, so the words don't drop every morning; viewing an earlier
day: the 7 ending on it), with at least 2 days of food:

| Nutrient | Measure | low / ok / high |
|---|---|---|
| Unsaturated fat | share of fat | < 55 % / ≤ 80 % / above |
| Saturated fat | share of energy | < 6 % / ≤ 11 % / above |
| Sugars (total) | against 90 g per 2000 kcal | < 50 % / ≤ 110 % / above |
| Salt | against 6 g a day | < 50 % / ≤ 105 % / above |
| Each vitamin and mineral | daily average against its reference (EU NRVs; iron and zinc by sex) | < 66 % / ≤ 150 % / above |

Vitamins and minerals are judged only when foods with an estimate make up at least 60 % of the kcal eaten, and are
scaled up to the whole. The weekly Insights get the same signals over four weeks.

## 3. The card

Under the macro summary, folded by default (the choice is remembered): "Vitamins, fats & sugar · Last 7 days · a rough
guide". Open, it shows two groups of tiles, each a name and a word:

- to get enough of: **A bit low** (grey dot) · **On point** · **Stacked** (green dot);
- to keep moderate (saturated fat, sugar, salt): **Chill** · **On point** (green) · **A lot** (soft amber).

Never red, never a number. Under it: a note when the vitamins aren't estimated yet, a note that vitamin D comes mostly
from sunlight when it reads low, and "a rough guide, never a target". Every word is in all seven languages.
