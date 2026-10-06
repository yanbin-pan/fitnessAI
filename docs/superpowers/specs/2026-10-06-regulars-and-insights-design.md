# Regulars and weekly Insights — design

Two features that read what someone has already logged and give it back: **regulars**, meals and activities that recur,
offered for one-tap logging in the chat; and **Insights**, a weekly coach's analysis of nutrition and training.

## 1. Principles

- Both are worked out from the log only. Nobody creates a regular by hand; the Regulars tab reviews, edits and removes.
- Numbers are computed in code. The model only interprets them (Insights), so every figure on screen is exact.
- Each person's data stays in their own database (2.2 §4). Nothing new leaves the server except the Insights call to
  Claude, which goes under the owner's key and counts against the person's daily cap like a coach message.

## 2. Regulars

### 2.1 Detection (`server/src/regulars/regulars.ts`)

- **Window:** the 28 days ending today. **Minimum data:** 5 days with anything logged in the window; before that the
  tab says how many days there are.
- **Occurrence:** one entry. Its items become keys: a food by its normalised name (lowercase, no numbers or
  punctuation), an exercise by its sport (`x:tennis`, so singles and doubles are one habit), or by name for `other`.
- **Grouping:** entries of the same kind (meal: has food; activity: exercise only), taken in time order, join the
  pattern whose first entry's keys are at least 60 % alike (Jaccard); otherwise they start a new one.
- **Regular:** a pattern seen on **3 different days** in the window.
- **Key:** sha-256 of the pattern's usual signature (the exact set of keys seen on the most days), first 16 hex. A
  signature the person has edited or removed keeps its key, so edits survive as the habit shifts.
- **Template** (what a tap logs): the person's edited items, else the items of the most recent entry with the usual
  signature, so portions follow the habit. **Typical time:** the median local time of its entries.
- Entries logged with a tap carry `entries.regular_key` and count towards that regular whatever their items.
- Nothing is stored except edits and removals (`regular_overrides`): regulars come and go with the habit.

### 2.2 In the chat

`DayView.suggestions` (today only): up to 3 regulars not yet logged today whose typical time is within 4 hours of now,
nearest first. The composer shows them as chips; a tap is `POST /api/regulars/:key/log {id}`, which logs the template to
today at now with source `regular`. The id is made on the phone and kept until the answer arrives, so a repeated tap after
a lost response logs once. No message goes to the coach.

### 2.3 The Regulars tab

`GET /api/regulars` lists them, meals then activities, with typical time and days seen. Tapping one opens an editor
(name and items, using the entry editor's rows): `PUT /api/regulars/:key` saves an edit; **Remove regular** is
`DELETE /api/regulars/:key`, which dismisses it for good. There is no add: `PUT`/`DELETE` refuse a key the analysis
didn't find (404).

## 3. Insights

### 3.1 When

- Starts once **14 days** have anything logged (ever).
- One analysis per local week, keyed by its Monday. It is written on the Monday (the hourly job at minute 23), or within
  the hour once someone first reaches 14 days, or when the tab is opened and it is due. It is rewritten within the week
  only if the person changes the app's language.
- Skipped while the day's call cap is used up (retried hourly), and when the coach is off.

### 3.2 The numbers (`server/src/insights/stats.ts`)

Over the 28 days ending yesterday:

- Daily averages over days with food, against each day's adjusted targets (kcal, protein, carbs, fat, fibre) and fixed
  limits (saturated fat 30 g men / 20 g women, total sugars 90 g reference, salt 6 g; drinks 2000 / 1600 ml).
- Protein g/kg, alcohol units a week, food-group portions a day.
- Training a week: sessions (entries with exercise), minutes, active kcal; by activity; sets per muscle (primary 1,
  secondary 0.5); training days in the last 7; longest run of training days; load ratio (last 7 days' active kcal over
  the 4-week weekly average).

### 3.3 The analysis (`server/src/insights/report.ts`)

One structured-output call (`output_config.format` with the report's JSON schema, adaptive thinking, effort `high`,
server-side refusal fallbacks, 180 s timeout): headline; nutrition summary and findings (title, detail, severity
good/watch/act, foods to close the gap); training summary and findings; recovery status (fresh, balanced, fatigued,
overreaching) with detail; 1–3 focus items. Written in the profile's language, only from the numbers, never medical
advice. The reply is validated against the same Zod schema; a refusal, cut-off or off-schema reply stores nothing.
Stored in `insights` (kept in snapshots: it holds no conversation).

### 3.4 The Insights tab

`GET /api/insights` returns `collecting` (days so far), `pending` (being written; last week's stays on screen; the tab
asks again every 10 s), `ready`, or `off` (no API key: the numbers alone). The page shows the headline, stat tiles,
nutrient meters (fill shows severity, tick at the target or limit, track to 150 %), findings with their severity in words,
by-activity badges, recovery and the week's focus. Severity colours were checked with the dataviz palette validator in
both themes and always appear beside their word.

## 4. Tabs

Today · Insights · Regulars · Settings. Icons added from `@material-symbols/svg-400@0.47.6` (monitoring, repeat, bedtime,
lightbulb) by the generator in the milestone 2.1 plan (Task 1, Step 4), with those four names appended to its list.

## 5. Data

Migration `0005_regulars_and_insights`: `entries.regular_key`, tables `regular_overrides` and `insights`. Rolling back
is safe: older versions ignore the column and tables.
