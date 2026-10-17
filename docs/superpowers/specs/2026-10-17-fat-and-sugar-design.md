# Fat and Sugar on Today — Design

Bin asked to track added sugar precisely and to see how much of the day's fat is unsaturated ("good") and how much
saturated. The macro bars stay as they are (bars split by colour read as clogged next to the drinks' stripes), so both
live in the **Vitamins, fats & sugar** card.

## 1. Data

- Every food item carries `added_sugars_g`: free sugars, the NHS / WHO definition. Sugar added to food plus honey,
  syrups and fruit juice; not the sugar in whole fruit, vegetables or plain milk. It is part of `sugars_g`.
- The coach estimates it with the other numbers (`log_items`, `update_entry`): one more field, no extra call. An
  estimate above `sugars_g` is held to it rather than sent back.
- Items logged before 2026-10-17, and items typed in by hand, have `null`: a day with no estimate shows no added sugar
  rather than 0, and a mixed day says how many items it leaves out.
- Unsaturated fat is `fat_g - saturated_fat_g` (never below 0); trans fat is too small to show.

## 2. The card

- Closed, while the day has fat or added sugar: the subtitle reads "Today: 48 g added sugar · 30 g saturated fat"
  (or "This day:" on an earlier day), each number red once over its maximum. Otherwise "Last 7 days · a rough guide".
- Open: a **Today** section above the 7-day words.
  - Fat: one bar, unsaturated in the fat colour, saturated in a darker shade, then "61 g unsaturated · 30 / 30 g
    saturated", red past the NHS maximum (30 g men, 20 g women).
  - Added sugar: the carbs colour (sugar is a carbohydrate: "of which sugars" on labels) up to the 30 g daily maximum,
    red stripes beyond it, and a marker at 30 g; then how far over or how much is left, and the total sugars.
  - Tapping a row lists the day's foods behind it: saturated fat by food, or added sugar by food with the rule above.
- Unlike the 7-day words, these are numbers against a maximum: precise tracking was asked for.

`shared/src/fatsugar.ts` holds the maxima and the day's sums; the card works them out from the day's items.
