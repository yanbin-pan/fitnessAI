# Alcohol on Today — Design

Drinks are logged like any food: the coach estimates their calories and macros. On top of that, Today shows what they
add, which kinds were had, and the week's units. Sketches: the "Alcohol tracking sketches" canvas, row "Chosen".

## 1. Kinds of drink

- Every food item carries `drink`: `beer` (also cider), `wine` (also prosecco and champagne), `cocktail` (also spirits,
  shots and long drinks such as a gin and tonic), or null for food and drinks without alcohol, alcohol-free beer
  included. The coach sets it (`log_items`, `update_entry`) and logs **each drink as an item of its own**, so two pints
  are two items: the app counts drinks by their items.
- An item with alcohol units but no kind (logged before kinds existed) still counts everywhere below, as "Other drinks".
- Pictograms: Material Symbols Rounded `sports_bar`, `wine_bar`, `local_bar`, in their own colours on matte discs, as
  the sport badges.

## 2. The drinks' share, striped

- An item is a drink when it has a kind or any alcohol units. Its whole kcal, alcohol and sugar alike, and its protein,
  carbs, fat and fibre are its share.
- The calorie ring draws food solid, then the drinks' share after it in diagonal stripes of the same colour on a paler
  tint (red stripes once over target). A line under the total says "560 kcal from drinks".
- Each macro bar stacks the drinks' grams after the food's the same way, in that macro's colour; its accessible value
  adds "40 g from drinks". The stripes read as extra without relying on colour, in both themes.

## 3. Badges and the week

- The badge row under the nutrients holds the sport badges, then one badge per kind had **on the day**, with how many
  and their units; kinds not had are not shown.
- While the 7 days ending on the day hold any drink, the row ends in a pill: the week's units and a small ring filling
  towards the UK Chief Medical Officers' guide of 14 units a week. Within (under 10.5): green stripes; close (10.5–14):
  amber; over 14: red with "!".
- Tapping the pill opens the week under the row: the units against the guide with its marker, how far over, the units
  day by day (the day itself outlined), the alcohol-free days, and each kind's drinks, units and kcal.
- Tapping a kind's badge opens its drinks of the day: each with its time, units and kcal, how much of their energy is
  the alcohol itself (56 kcal a unit: 8 g at 7 kcal/g), and Edit for their entry.
- Every day view carries `alcohol: { units, status, days[7], alcohol_free_days, drinks[] }` for the 7 days ending on that
  day (as the nutrient signals), or null when none of them holds a drink (`shared/src/alcohol.ts`).
