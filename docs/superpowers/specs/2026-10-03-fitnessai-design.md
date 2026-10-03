# fitnessAI — Design

| | |
|---|---|
| **Date** | 2026-10-03 |
| **Status** | Draft — awaiting owner review |
| **Repository** | <https://github.com/yanbin-pan/fitnessAI> (public) |
| **Deploys to** | <https://github.com/yanbin-pan/home-cluster> — k3s on four Raspberry Pi 4s |
| **Reference app** | <https://github.com/yanbin-pan/tea-cabinet> — same deployment shape |

---

## 1. Summary

fitnessAI is a single-user, mobile-first web app (PWA) that is both a **nutrition and
training logbook** and an **AI nutritionist**.

One composer accepts text — including the phone keyboard's dictation, which is how voice
works — and photos. A Claude-powered coach **logs what you state as fact** (meals,
workouts, body measurements) and **answers questions in context**: today in full, the
previous five days, your training and your body measurements. When you ask about food you
haven't eaten ("should I have a Big Mac? I'm in a deficit"), it answers and offers a
**"Log it"** card; nothing is written unless you tap it.

Daily calorie, protein, carb, fat and fibre targets are calculated from your profile and
adjusted for the exercise you do. Apple Watch workouts and body metrics arrive
automatically through the Health Auto Export iOS app. Every day starts with a fresh page;
history, trends, weekly training goals and streaks are built from what you log.

It runs as one container on the home cluster at `fitness.minipi.net`, behind Cloudflare
Access, deployed by Flux from this repository.

---

## 2. Goals and non-goals

### Goals (v1)

- Log food, exercise and body measurements in natural language or by photo, with as
  little friction as possible.
- Consult the coach about food choices with full context, without hypotheticals ever
  entering the log unconfirmed.
- Calculate daily targets and adjust them for exercise.
- A fresh day page every day, plus history, trends, weekly training goals and streaks.
- Automatic Apple Watch workout and body-metric sync.
- Installable on iPhone; logging keeps working offline.
- Deployed by GitOps like the owner's other apps; no data loss from a node failure.

### Non-goals (v1)

- Multiple users, sharing, social features.
- Native iOS or Android apps (a native HealthKit companion is a possible later upgrade).
- In-app audio recording or transcription — keyboard dictation covers voice.
- Medical advice or diagnosis.
- Barcode scanning, meal planning, recipes.
- A body-weight goal — measurements get trend charts only.
- Blood test results — planned for a later version (§18).

---

## 3. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | PWA, mobile-first, single user | Logging happens on the phone; no app store; one owner. |
| D2 | TypeScript in one container: React PWA + Fastify + SQLite (Drizzle on better-sqlite3) | SQLite on NFS forces a single replica, so a separate frontend container buys nothing. Same language as tea-cabinet, so its CI, Access verification and Claude patterns carry over. |
| D3 | Claude API, model set by environment (default `claude-opus-5-5`) | Best estimates; runs fine from a Pi. Switching to `claude-sonnet-5-5` roughly halves cost. |
| D4 | Voice through phone keyboard dictation | The Claude API accepts text, images and PDFs but not audio; on-cluster Whisper would be slow on Pi 4s. |
| D5 | One composer; the coach decides whether to log or advise | The owner wants to log ("I ate this for lunch") and consult ("should I have a Big Mac?") in the same place. |
| D6 | Statements of fact are logged immediately with Undo; questions and hypotheticals produce a "Log it" draft | Owner preference: save immediately, edit later. Hypotheticals never pollute the log. |
| D7 | Coach context: today in full, the previous 5 days in brief, a body summary | Advice should reflect the recent picture, with today weighted most. |
| D8 | One coach thread per day; the thread's prefix is frozen at its first message | Bounded context and cost. History stays append-only, which current Claude models require and which keeps the prompt cache warm. |
| D9 | Photos kept for 48 hours | They only matter while the conversation that references them is live. |
| D10 | Targets: Mifflin-St Jeor × activity (excluding workouts) + goal rate, every value overridable; add back 50 % (configurable) of workout calories | Standard and explainable. Calorie-burn estimates run high, so only part is added back. |
| D11 | Exercise calories are *active* calories: watch-measured where available, otherwise (MET − 1) × kg × hours | Matches Apple's definition of active energy, so the two sources are comparable and add-back isn't inflated by resting burn. |
| D12 | Apple Health through Health Auto Export → `POST /api/ingest/health`, authenticated with a Cloudflare Access service token | No code on the phone; documented JSON with stable workout IDs; authentication enforced at Cloudflare's edge. |
| D13 | Weight used for targets: 7-day average of weigh-ins, falling back to profile weight | Smooths out daily water swings. |
| D14 | Deploy like tea-cabinet: arm64 image on GHCR, CI pins the tag in `k8s/`, Flux watches this repository | The owner's established pattern; no cluster credentials in GitHub. |

---

## 4. Architecture

```
Phone (installed PWA)                         iPhone: Health Auto Export
  │ HTTPS fitness.minipi.net                    │ HTTPS POST + service-token headers
  ▼                                             ▼
Cloudflare edge ─ TLS · Access: owner email (30-day session) · service token for /api/ingest
  ▼ Cloudflare Tunnel (outbound only)
Traefik ─ rate limits keyed on Cf-Connecting-Ip
  ▼
fitnessai pod (1 replica, strategy: Recreate)
  Fastify on Node 24
  ├── /           built PWA (service worker, manifest, icons)
  ├── /api/*      JSON API — verifies Cf-Access-Jwt-Assertion on every request
  ├── jobs        03:00 database snapshot · hourly photo purge
  ├── :9464       Prometheus metrics (no Ingress route)
  ├── /data       `ssd` PVC (NFS on rpi-01, backed up nightly to R2)
  │    ├── fitness.db
  │    ├── photos/
  │    └── snapshots/
  └── → Claude API (Anthropic TypeScript SDK; key from a SOPS-encrypted Secret)
```

### 4.1 Server modules

Each module has one job and can be tested on its own.

| Module | Responsibility | Depends on |
|---|---|---|
| `auth` | Verifies the Access JWT: owner email for app routes, service token for ingest | `jose` |
| `db` | Drizzle schema, migrations at startup, connection settings (§14.4) | better-sqlite3 |
| `targets` | Pure functions: BMR, baseline, overrides, exercise adjustment | nothing |
| `days` | Day rows and snapshots, totals, burn, weekly goals, streaks | `db`, `targets` |
| `log` | Create, edit and delete entries and items; merge and split | `db` |
| `measurements` | Body measurements; weight averaging | `db` |
| `foods` | Saved foods and alias matching | `db` |
| `coach` | Thread assembly, context building, the tool loop, tool execution | `ai`, `log`, `days`, `measurements`, `foods` |
| `ai` | Thin wrapper over the Anthropic SDK — the only module that talks to Claude; replaced by a fake in tests | `@anthropic-ai/sdk` |
| `ingest` | Health Auto Export parsing and upserts | `log`, `measurements`, `db` |
| `photos` | Store, serve and purge photos | filesystem |
| `jobs` | In-process scheduler for the snapshot and purge jobs | `db`, `photos` |

### 4.2 Repository layout

```
web/                 React PWA (Vite)
server/              Fastify API
shared/              TypeScript types and Zod schemas used by both
k8s/                 Manifests Flux applies
.github/workflows/   verify.yaml, ci.yaml
docs/superpowers/    specs and plans
```

---

## 5. Data model

SQLite. Timestamps are UTC ISO-8601 strings. `date` columns are local calendar dates
(`YYYY-MM-DD`) in the profile's timezone. Rows created from the phone use client-generated
UUIDs so that repeated submissions are idempotent.

**`profile`** — exactly one row.

| Column | Notes |
|---|---|
| `sex` | `male` / `female` — selects the Mifflin-St Jeor constant |
| `birth_date`, `height_cm` | |
| `weight_kg` | fallback when there are no recent weigh-ins (§7.4) |
| `activity_level` | `sedentary` 1.2 · `light` 1.375 · `moderate` 1.55 · `very` 1.725 — day-to-day activity **excluding workouts** |
| `goal`, `goal_rate_kg_week` | `lose` / `maintain` / `gain`; rate 0–1 kg per week |
| `protein_g_per_kg` | default 1.8 |
| `fat_pct` | default 30 |
| `fibre_g` | default 30 (UK guideline) |
| `add_back_pct` | default 50 |
| `override_kcal`, `override_protein_g`, `override_carbs_g`, `override_fat_g`, `override_fibre_g` | nullable |
| `timezone` | default `Europe/London` |
| `units_mass`, `units_length` | `kg` / `st_lb`, `cm` / `in` — display only |
| `context_days` | default 5 |

**`days`**

| Column | Notes |
|---|---|
| `date` | primary key |
| `base_kcal`, `base_protein_g`, `base_carbs_g`, `base_fat_g`, `base_fibre_g` | snapshot of the baseline targets |
| `add_back_pct`, `weight_kg_used` | snapshot |
| `created_at`, `updated_at` | |

**`entries`** — a group of items logged together.

| Column | Notes |
|---|---|
| `id` | UUID |
| `date`, `logged_at` | `logged_at` is when it was eaten or done; defaults to the message time |
| `source` | `coach` / `photo` / `saved_food` / `manual` / `apple_health` |
| `message_id` | the originating user message; nullable |
| `external_id` | Apple workout UUID; unique; nullable |
| `merged_into_entry_id` | set when this exercise entry is merged into a watch workout (§10.3) |
| `edited` | boolean |
| `deleted_at` | tombstone, used only for `apple_health` entries so re-sent data can't resurrect them; other entries are deleted outright |
| `created_at`, `updated_at` | |

**`food_items`** — `id`, `entry_id`, `position`, `name`, `quantity` (text), `grams`
(nullable), `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fibre_g`, `assumption` (text),
`saved_food_id` (nullable).

**`exercise_items`** — `id`, `entry_id`, `position`, `name`, `category`
(`strength` / `cardio` / `mobility` / `sport`), `duration_min`, `sets`, `reps`,
`weight_kg`, `distance_km`, `avg_hr` (all nullable), `met` (nullable), `kcal` (active
kcal), `kcal_measured` (boolean), `assumption`.

**`exercise_muscles`** — `exercise_item_id`, `muscle` (§5.1), `role`
(`primary` / `secondary`).

**`measurements`** — `id`, `measured_at`, `date`, `metric` (§5.1), `value` (canonical
unit), `unit` and `label` (custom metrics only), `source`
(`coach` / `photo` / `apple_health` / `manual`), `message_id` (nullable), `external_key`
(unique, nullable; `metric|timestamp` for Apple Health), `created_at`.

**`daily_activity`** — `date` (primary key), `active_kcal`, `source` (`apple_health`),
`updated_at`.

**`saved_foods`** — `id`, `name`, `aliases` (JSON array, normalised to lowercase), `items`
(JSON array of food items), `use_count`, `last_used_at`, `created_at`.

**`drafts`** — `id`, `message_id`, `date`, `payload` (JSON foods and exercises),
`committed_entry_id` (nullable), `created_at`.

**`goals`** — `id`, `type`
(`workouts_per_week` / `cardio_minutes_per_week` / `sets_per_muscle_per_week` /
`daily_burn_kcal`), `target`, `muscle` (nullable — a sets goal with no muscle applies to
every muscle), `active`, `created_at`.

**`messages`** — the conversation as the owner sees it.

| Column | Notes |
|---|---|
| `id` | client UUID for user messages |
| `date` | derived from `sent_at` in the profile timezone |
| `role` | `user` / `assistant` / `note` (non-AI notices such as "Logged usual breakfast") |
| `text` | |
| `photo_ids` | JSON array |
| `cards` | JSON references to logged entries, drafts and measurements |
| `status`, `error_code` | user messages: `pending` / `done` / `failed` |
| `sent_at`, `created_at` | |

**`coach_threads`** — `date` (primary key), `prefix` (the frozen system prompt and context
blocks), `created_at`.

**`coach_turns`** — the exact Claude API turns, replayed append-only: `id`, `date`, `seq`,
`role` (`user` / `assistant`), `blocks` (JSON content blocks exactly as sent or received,
including tool calls, tool results and thinking blocks), `created_at`.

**`photos`** — `id` (random 128-bit hex), `message_id`, `path`, `media_type`, `bytes`,
`created_at`, `purged_at`.

**`ai_usage`** — `id`, `date`, `message_id`, `model`, `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_write_tokens`, `cost_usd_estimate`, `created_at`.

**`sync_log`** — `id`, `received_at`, `workouts_upserted`, `metrics_upserted`,
`items_skipped`, `error`.

### 5.1 Fixed vocabularies

- **Muscles (12):** `chest`, `upper_back`, `lats`, `shoulders`, `biceps`, `triceps`,
  `forearms`, `core`, `glutes`, `quads`, `hamstrings`, `calves`.
- **Measurement metrics:** `weight_kg`, `body_fat_pct`, `fat_mass_kg`, `lean_mass_kg`,
  `skeletal_muscle_kg`, `visceral_fat_level`, `body_water_pct`, `neck_cm`, `chest_cm`,
  `waist_cm`, `hips_cm`, `arm_left_cm`, `arm_right_cm`, `thigh_left_cm`, `thigh_right_cm`,
  `custom`.

Both lists are enums in the coach's tool schemas, so Claude can only choose from them and
charts never split across synonyms.

### 5.2 Derived, never stored

Adjusted targets, daily totals, remaining budget, burn, weekly goal progress, streaks and
muscle volume are recomputed from the stored facts on every read, so nothing can drift out
of sync.

---

## 6. The coach

### 6.1 Interaction

The composer takes text (keyboard dictation works) and up to four photos. Every message
goes to the coach, which acts through tools:

| Tool | Effect |
|---|---|
| `log_items` | Creates an entry with foods and/or exercises. Optional `date` (within the last 7 days), `logged_at`, and `attach_to_entry_id` to attach details to a watch workout. |
| `draft_items` | Creates a "Log it" draft card. Writes nothing to the log. |
| `update_entry` | Replaces an entry's items — corrections such as "it was 2 eggs, not 3". |
| `log_measurements` | Records body measurements. |
| `save_food` | Saves foods, or an existing entry, as a saved food with aliases. |
| `get_day` | Returns one day in full. |
| `get_history` | Returns daily summaries and muscle volume for a date range. |
| `get_measurements` | Returns one metric over a date range. |

Rules in the coach's instructions:

- A statement of fact ("I had…", "just did…", "weighed…") is logged immediately.
- Questions, hypotheticals and anything ambiguous get an answer and, where useful, a
  draft — never a log entry.
- When you describe a workout that matches a synced watch workout, the coach attaches the
  details to it (§10.3) rather than creating a duplicate.
- The coach never deletes; deleting is the owner's Undo.
- It gives general nutrition and training guidance and does not diagnose.

Every write appears in the feed as a card with **Undo**. Every item shows its `assumption`
(for example "medium latte, whole milk, ~350 ml") so a wrong guess is visible and one tap
from being fixed.

### 6.2 Context

Each day's thread has two layers.

**Frozen prefix** — built at the day's first coach message and unchanged for the rest of
the day, so it is cached:

- the coach's instructions;
- the profile and how today's targets are derived;
- saved foods (names, aliases, macros);
- the previous `context_days` days (default 5), each with totals against targets, one line
  per food item (name, kcal, protein, carbs, fat) and an exercise summary (kcal, muscles);
- a body summary: the latest value of each metric, the 7-day average weight and the
  30-day change;
- muscles not trained for 7 or more days.

**Per-turn block** — included in each new user turn:

- local date and time;
- today's adjusted targets, totals and remaining budget;
- every entry today in full: time, items, macros, assumptions, watch workouts and their
  merge state;
- today's measurements;
- weekly goal progress and streaks;
- anything that changed since the prefix was frozen: saved foods, measurements, profile,
  edits to past days.

The instructions say that today is what the coach is advising on and the previous days are
the pattern. History is append-only: earlier turns are replayed exactly as stored in
`coach_turns` and never edited.

### 6.3 Processing a message (`POST /api/messages`)

1. Validate the request and insert the user message as `pending`, keyed by its client
   UUID. A repeated UUID returns the stored result without processing again. Store any
   photos.
2. If the text alone (no photos), trimmed and lowercased, exactly matches a saved food's
   name or alias, log it, add a `note` message, and stop — no AI call.
3. If today's AI call cap is reached, mark the message `failed` with `ai_cap`.
4. Build the request — the frozen prefix (created if this is the date's first message),
   the prior turns, and the new turn — and run the tool loop: at most 5 model calls and
   90 seconds in total, which stays under Cloudflare's 100-second proxy timeout. Each tool
   runs in its own database transaction.
5. For exercises, Claude supplies `met` and `duration_min` (estimating duration from sets
   where needed); the server computes active kcal (§7.3).
6. Save the assistant message and its cards, the raw turns and the `ai_usage` row; mark
   the user message `done`.
7. Respond with the assistant message, changed entries, drafts and measurements, and the
   updated day summary.

Any failure — timeout, API error, refusal, an invalid tool call — marks the message
`failed` with an error code. Its text and photos are kept, and the UI offers **Retry**
(`POST /api/messages/:id/retry`).

### 6.4 Claude configuration

- Model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`); effort from `ANTHROPIC_EFFORT`
  (default `medium`).
- Every tool is `strict: true`, with schemas generated from the shared Zod definitions.
  `tool_choice` is `auto`; current models reject forced tool choice.
- Server-side refusal fallback is enabled (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`).
- Prompt caching covers the frozen prefix and the growing thread.
- Estimated cost: about $0.02–0.05 per message on Opus 5.5, roughly $10–20 a month at 15
  messages a day; about half that on Sonnet 5.5. Tracked in `ai_usage` and exported as
  metrics.
- `AI_DAILY_CALL_CAP` (default 200) limits Claude API calls — each model call in a tool
  loop counts — per local day, guarding against a runaway retry loop.

### 6.5 Photos

- The phone resizes each photo to at most 1568 px on the long edge, as JPEG, before
  upload. The server accepts JPEG or PNG up to 8 MB.
- Photos are served only through the authenticated API at `/api/photos/:id`.
- They are purged 48 hours after upload (`PHOTO_RETENTION_HOURS`); the feed then shows
  "photo expired". Body-scan photos follow the same rule — the numbers are kept, the image
  is not.

---

## 7. Targets and the day

### 7.1 Baseline

- Age is calculated from the birth date on the day in question.
- **BMR** = 10 × kg + 6.25 × cm − 5 × age + 5 (male) or − 161 (female).
- **Maintenance** = BMR × activity factor.
- **Goal delta** = rate (kg/week) × 7700 ÷ 7 — negative when losing, positive when
  gaining, zero when maintaining.
- **kcal** = max(BMR, maintenance + goal delta).
- **Protein** = `protein_g_per_kg` × kg. **Fat** = `fat_pct` × kcal ÷ 9.
  **Carbs** = max(0, (kcal − 4 × protein − 9 × fat) ÷ 4). **Fibre** = `fibre_g`.
- Overrides replace calculated values. Carbs stay the remainder unless overridden
  themselves; fat follows an overridden kcal unless overridden itself.
- Calculations use unrounded values; targets are displayed rounded to the nearest 10 kcal
  and whole grams.

### 7.2 Exercise adjustment (calculated live)

- **workout_kcal** = active kcal of the day's workouts, counting each merged pair once
  using the watch's figure (§10.3).
- **add_back** = `add_back_pct` × workout_kcal.
- **Strength day** (any strength item that day): protein increases by
  min(0.2 g × kg, add_back ÷ 4) grams — the increase is paid for out of the add-back and
  never exceeds it.
- The remaining add-back (add_back − 4 × protein increase) goes 75 % to carbs and 25 % to
  fat. Fibre is unchanged.
- **Adjusted kcal** = base kcal + add_back.

### 7.3 Exercise calories

Always active calories. Watch workouts use Apple's `activeEnergyBurned`. Everything else
uses (MET − 1) × `weight_kg_used` × hours, with the MET value supplied by Claude.

### 7.4 Weight used

The mean of weight readings dated within the 7 days ending on the date. If there are none,
the latest reading within 14 days. Otherwise, the profile weight. Stored in the day
snapshot as `weight_kg_used`.

### 7.5 Day lifecycle

- "Today" is calculated in the profile's timezone; the pod runs in UTC.
- A day's row is created the first time anything touches that date (opening the app,
  logging, a sync, the coach). There is no midnight job.
- Profile changes and new weigh-ins recompute today's snapshot. Past days keep theirs.
- Back-dating up to 7 days is allowed ("yesterday I had…").
- A message's date comes from its `sent_at` time in the profile timezone, so an offline
  entry typed at 23:55 stays on that day even if it uploads after midnight.
- The coach thread for a date starts fresh at local midnight.

---

## 8. Goals and streaks

Weeks run Monday to Sunday in the profile timezone.

| Goal type | How it's measured |
|---|---|
| `workouts_per_week` | exercise entries totalling at least 10 minutes; a merged pair counts once |
| `cardio_minutes_per_week` | total duration of cardio items, using the watch duration for merged pairs |
| `sets_per_muscle_per_week` | per muscle: primary sets + 0.5 × secondary sets, from strength items only; the target applies to one muscle or to every muscle |
| `daily_burn_kcal` | the watch's active energy for the day when present, otherwise workout kcal |

Streaks are calculated, not stored:

- **Logging:** at least one food item that day.
- **Protein:** protein eaten at or above the adjusted protein target.
- **Calories:** within ±10 % of the adjusted calorie target.
- **Burn:** daily burn target met (only when that goal exists).

Today extends a streak once it's achieved and never breaks one before the day is over.

---

## 9. Body measurements

- **Sources:** the coach (text), photos (scan printouts, smart-scale screenshots), Apple
  Health, and manual edits.
- **Units:** stored in kg and cm. The coach converts stone, pounds and inches; display
  units follow the profile.
- **Scan fields outside the fixed list** (segmental lean mass, phase angle, and so on) are
  stored as `custom` with their label and unit. They appear in the readings table but are
  not charted.
- **Body page:** a trend chart per metric (weight also shows its 7-day average line) and
  an editable table of all readings.

---

## 10. Apple Health sync

### 10.1 Phone setup (also documented in the README)

Health Auto Export with Premium (a lifetime purchase, $24.99 at the time of writing),
configured as a REST API automation:

- URL `https://fitness.minipi.net/api/ingest/health`, method POST, format **JSON v2**.
- Headers `CF-Access-Client-Id` and `CF-Access-Client-Secret` — the service token.
- Date range **Default** (the previous full day plus today), so every payload contains
  complete days.
- Data: workouts (route data off) and the metrics active energy, body mass, body fat
  percentage, lean body mass and waist circumference, aggregated by day where the app
  offers it.
- Batch requests on.

iOS only lets apps read Health data while the phone is unlocked, so a sync happens the
next time you use your phone after a workout. The app's home-screen widget improves
reliability.

### 10.2 The ingest endpoint

- **Authentication:** the service token only (§13).
- **Parsing:** accepts the payload with or without a `data` envelope. Each item is
  validated on its own; invalid items are skipped and counted. Body limit 10 MB.
- **Workouts:** upserted by their `id` (a UUID) as an `apple_health` entry with one
  measured exercise item — name, category (from a fixed map of Apple workout names; unknown
  types become `sport`), duration, active kcal, distance (converted to km) and average heart
  rate. The entry's date is the local date of `start`.
- **Muscles for synced workouts:** cardio types get muscles from a fixed map (running:
  quads, hamstrings, glutes and calves as primary, core as secondary) but no sets. Strength
  workouts get muscles only when details are attached.
- **Deleted workouts:** an `apple_health` entry deleted in the app keeps a tombstone, so
  data sent again doesn't bring it back. Deleting a workout on the watch does not carry
  over; delete it in the app.
- **Active energy:** for each date in the payload, the day's total replaces the stored
  `daily_activity` value. The Default date range guarantees complete days.
- **Body metrics:** upserted into `measurements` by `metric|timestamp`.
- Writes a `sync_log` row and responds with counts.

### 10.3 Merging with logged workouts

One mechanism: `entries.merged_into_entry_id`.

- **Logged first, watch later:** when a watch workout arrives, an unmerged exercise entry on
  the same date containing at least one item of the workout's category (for example, a
  strength item for "Traditional Strength Training") is merged into it. If there are
  several, the one whose `logged_at` is closest to the workout's start is chosen. A
  mismatch is one tap to undo with Split.
- **Watch first, logged later:** the coach sees today's watch workouts and calls
  `log_items` with `attach_to_entry_id`, creating an entry merged into the workout.
- **Effect:** the watch provides the calories and duration. The merged entry contributes
  exercises, sets and muscles but no calories.
- The feed shows "merged with Apple Watch workout" with a **Split** action that clears the
  link.

---

## 11. Frontend

### 11.1 Screens

Tabs: **Today · History · Trends · Body · Settings**.

- **Today:**
  - A summary header that collapses on scroll: calories eaten against the adjusted target
    (with the add-back shown), protein / carbs / fat / fibre bars, and burn against its
    target.
  - One feed mixing coach messages and cards: food, exercise (with a watch badge),
    measurements and drafts, each with Undo, edit or Split as appropriate.
  - A **"Log only"** switch that hides the conversation and leaves a clean logbook.
  - The composer pinned at the bottom, with **"+ Add manually"** (name, kcal, macros) for
    when the AI is unavailable.
- **History:** past days with a small summary each. A day opens read-only (its thread);
  its entries can still be edited.
- **Trends:** over 7, 30 or 90 days — calories against the adjusted target, macros, burn, a
  muscle-by-week grid coloured by sets against target, goal progress and streaks.
- **Body:** §9.
- **Settings:** profile; targets with calculated values shown beside any override;
  add-back %; goals; the saved-foods library; units; the coach's context days; today's AI
  calls against the cap and the month-to-date cost estimate; Apple Health sync status (last
  received, counts).

Stack: React, Vite, TypeScript, React Router, TanStack Query, Tailwind and Recharts. Dark
mode follows the system setting.

### 11.2 Offline

- The app shell is precached by a service worker (vite-plugin-pwa / Workbox), so the app
  opens instantly without signal.
- The query cache is persisted to IndexedDB; offline views are labelled
  "offline · as of HH:MM".
- **Outbox:** unsent messages (text, resized photos, client UUID, `sent_at`) are stored in
  IndexedDB and shown in the feed as queued. They are sent in order when the app opens, when
  the connection returns, and on a retry schedule that backs off. iOS gives web apps no
  background sync, so the outbox empties while the app is open.
- Edits, Undo, "Log it" and Split need a connection.

### 11.3 Staying signed in behind Access

- API requests use `redirect: "manual"`. The server never redirects API calls, so an
  `opaqueredirect` response means the Access session expired — not that the phone is
  offline. The app then shows "Signed out — tap to sign in", which performs a full
  navigation (bypassing the service-worker cache) through the Access login and back. The
  outbox is kept.
- The Access session for this app lasts 30 days.
- The open risk and its fallback are in §16.

---

## 12. API (indicative — the implementation plan may refine it)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness; registered before authentication; returns `{ok:true}` only |
| `GET` | `/api/days/:date` | Day view (`:date` may be `today`): base and adjusted targets, totals, entries, messages, drafts, measurements, burn |
| `GET` | `/api/days?from=&to=` | Day summaries for History |
| `POST` | `/api/messages` | Send a message (multipart: `id`, `sent_at`, `text`, `photos[]`) |
| `POST` | `/api/messages/:id/retry` | Retry a failed message |
| `POST` | `/api/drafts/:id/commit` | "Log it" |
| `POST` | `/api/entries` | Add an entry manually |
| `PATCH` | `/api/entries/:id` | Edit an entry's items |
| `DELETE` | `/api/entries/:id` | Undo or delete (tombstone for `apple_health`) |
| `POST` | `/api/entries/:id/split` | Undo a merge |
| `GET`, `PUT` | `/api/profile` | Profile and settings |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/goals[/:id]` | Goals |
| `GET` | `/api/trends?from=&to=` | Aggregates for charts |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/measurements[/:id]` | Body measurements |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/saved-foods[/:id]` | Saved foods |
| `GET` | `/api/photos/:id` | A stored photo |
| `GET` | `/api/status` | AI calls today against the cap, month-to-date cost, last sync |
| `POST` | `/api/ingest/health` | Health Auto Export payloads (service token only) |

---

## 13. Security

- **At the edge:**
  - An Access application for `fitness.minipi.net`: the owner's email, one-time PIN,
    30-day session.
  - A separate, path-scoped Access application for `fitness.minipi.net/api/ingest` that
    allows only the Health Auto Export service token.
- **In the app** (fails closed with a bodiless 401):
  - Every `/api/*` request except `/api/health` must carry a valid
    `Cf-Access-Jwt-Assertion`: signature checked against the team's keys, plus issuer and
    expiry.
  - App routes require audience `ACCESS_AUD` and `email == OWNER_EMAIL`, so even a
    loosened Access policy admits only the owner.
  - `/api/ingest/*` requires audience `ACCESS_INGEST_AUD` and
    `common_name == ACCESS_INGEST_CLIENT_ID`.
  - The app refuses to start if any of these settings is missing. A test-only key-set
    override is ignored when `NODE_ENV=production`.
- **Secrets:**
  - The Anthropic key is a SOPS-encrypted Secret, using the cluster's existing age key.
  - The service token's secret lives only in Cloudflare and the export app; the cluster
    holds only its client ID.
  - CI fails if a key-shaped string appears in `web/` or if any `*.sops.yaml` file is
    unencrypted.
- **Exposure:**
  - Metrics are on a separate port with no Ingress route.
  - Photos are reachable only through the authenticated API, with unguessable IDs.
  - Logs record request metadata only — never message text, photos or health values.
- **Prompt injection** (for example, text inside a photo): the coach's tools only touch the
  owner's own log, and every write is visible with Undo. Accepted.
- **Public repository:** no real health data is committed. The Health Auto Export test
  payload is anonymised.

---

## 14. Deployment and operations

### 14.1 Image and CI

- **Image:** Node 24 on Debian-slim (prebuilt arm64 `better-sqlite3`), running as non-root
  with a read-only root filesystem; only `/data` and `/tmp` are writable.
- **`verify.yaml`** (every branch and pull request; reused by `ci.yaml`):
  - type-check, lint, server and web tests, production build;
  - `kustomize build k8s` with assertions: rate-limit middlewares present and keyed on
    `Cf-Connecting-Ip`, required environment variables set, `replicas: 1`,
    `strategy: Recreate`;
  - SOPS and frontend-secret checks;
  - an image boot test: build natively, run with throwaway Access settings, and expect
    `GET /api/health` to return `{ok:true}`.
- **`ci.yaml`** (merge to `main`): verify → buildx `linux/arm64` → push
  `ghcr.io/yanbin-pan/fitnessai:<sha>` and `:latest` → assert the pushed image is arm64 →
  commit the pinned tag to `k8s/kustomization.yaml` (that path is ignored by the trigger,
  avoiding a loop) → Flux deploys.

### 14.2 Kubernetes (`k8s/`)

- Namespace `fitnessai`.
- PVC: storage class `ssd`, `ReadWriteOnce`, 2 Gi.
- Deployment: 1 replica, `strategy: Recreate`; requests 64 Mi and 50m CPU, memory limit
  384 Mi; readiness and liveness probes on `/api/health`, plus a startup probe allowing
  3 minutes so the startup lock wait (§14.4) can't get the pod killed; annotations
  `prometheus.io/scrape: "true"` and `prometheus.io/port: "9464"`.
- Service; Ingress for `fitness.minipi.net`; Traefik rate-limit middlewares (general for
  `/api`, stricter for `/api/messages` and `/api/ingest`).
- Secret `anthropic` (SOPS-encrypted).
- Environment: `PORT`, `METRICS_PORT`, `DATA_DIR`, `NODE_ENV`, `ACCESS_TEAM_DOMAIN`,
  `ACCESS_AUD`, `ACCESS_INGEST_AUD`, `ACCESS_INGEST_CLIENT_ID`, `OWNER_EMAIL`,
  `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `AI_DAILY_CALL_CAP`, `PHOTO_RETENTION_HOURS`,
  `SNAPSHOT_KEEP`.

### 14.3 Changes in home-cluster (two pull requests)

1. **Milestone 1:**
   - `clusters/home/fitnessai.yaml`: a `GitRepository` (public HTTPS, 1-minute interval)
     and a `Kustomization` (`path: ./k8s`, `dependsOn: infrastructure`, SOPS decryption
     through `sops-age`, `wait: true`, `timeout: 5m`), following `tea-cabinet.yaml`.
   - Terraform: the Access application for `fitness.minipi.net` (§13).
2. **Milestone 3:** Terraform: the path-scoped Access application for `/api/ingest`, its
   service token and policy, and `Access: Service Tokens → Edit` added to the Cloudflare
   API token's permissions.

No DNS or tunnel changes in either.

### 14.4 The database on NFS

- **Rollback-journal mode**, because WAL mode needs shared memory, which NFS doesn't
  provide. `synchronous=FULL`, a single connection.
- **`locking_mode=EXCLUSIVE`**, held for the life of the process, as a guard against a
  second pod opening the file. At startup the app retries for up to 2 minutes while an old
  lock's NFS lease expires.
- **Snapshots:** at 03:00 in the profile timezone, `VACUUM INTO
  /data/snapshots/fitness-YYYY-MM-DD.db`, keeping 7. These give the 03:30 restic run
  consistent copies. A snapshot is also taken before migrations are applied.
- **Restore** (documented in the README): scale to 0, copy a snapshot over `fitness.db`,
  scale back to 1.

### 14.5 Monitoring

- Structured logs from Fastify (pino).
- Prometheus metrics: HTTP request counts and latency; coach calls; failures by error code;
  tokens and estimated cost; ingest counts and the time of the last successful sync.

---

## 15. Testing

- **Unit tests (Vitest):**
  - the targets engine against reference values — BMR, the BMR floor, overrides,
    add-back, strength-day protein;
  - weight averaging;
  - goals and streaks;
  - timezone boundaries — the GMT/BST changeovers, and a message sent at 23:55 that uploads
    after midnight;
  - Health Auto Export parsing — anonymised sample payload, unit conversion, envelope
    variants;
  - merge and split rules.
- **API tests (Vitest with Fastify `inject`, against a temporary SQLite file):**
  - every route;
  - the authentication matrix: owner, another email, the service token on each route
    type, wrong audience, expired, missing;
  - replaying the same message ID;
  - back-dated outbox messages;
  - re-sent sync payloads;
  - the saved-food shortcut and the AI cap.
- **Coach:** in CI the `ai` module is replaced by a fake that returns recorded tool calls,
  so tests need no network and cost nothing. Tool executors are tested directly.
- **Coach evaluation set** (run manually before changing prompts or models): about 30
  realistic messages checking log-or-advise decisions, portion estimates, muscle mapping and
  measurement extraction. A run costs cents.
- **Web:** Testing Library for the outbox, signed-out detection and the feed; a few
  Playwright smoke tests at phone size against the built container with the fake AI.
- **CI image boot test** (§14.1).
- **On the owner's iPhone (milestone 1):** install to the home screen, the Access re-login
  test (§16), keyboard dictation, the camera.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| The Access login inside an installed iPhone web app may store its cookie in Safari's storage instead of the app's, so signing in again fails | A test on the real phone in milestone 1. Fallback: pair the phone once with a Cloudflare service token that the service worker attaches to every request — a long-lived credential on the phone, revocable in Cloudflare. |
| Health Auto Export only syncs while the phone is unlocked | Accepted. The widget improves reliability; sync status is shown in Settings. |
| AI portion estimates are wrong | Assumption notes on every item, direct edits, corrections through the coach, label photos, saved foods. |
| AI costs drift upward | `ai_usage` table, metrics, month-to-date cost in Settings, daily cap, model switch by environment variable. |
| SQLite corruption on NFS | One replica, `ReadWriteOnce`, `Recreate`, exclusive locking, rollback journal, nightly consistent snapshots. |
| Coach replies approach Cloudflare's 100-second timeout | A 90-second budget, after which the message is `failed` with Retry. |
| The cluster's Prometheus may not scrape pod annotations | Check its scrape configuration in milestone 1; add a scrape job in home-cluster if needed. |

---

## 17. Milestones

Each milestone ends deployed and usable.

1. **Foundation and logging:** scaffolding; schema and migrations; profile, targets and the
   day lifecycle; the coach with `log_items` and `update_entry` (text only); manual add,
   edit and Undo; the Today screen; Access verification; CI/CD; `k8s/`; the home-cluster
   pull request (Flux and the app's Access application); database snapshots; the iPhone
   test.
2. **Full coach and photos:** advice and drafts; context assembly (frozen prefix and
   per-turn block); photos (upload, vision, purge); `log_measurements`; the `get_*` tools;
   the AI cap and usage tracking; the evaluation set.
3. **Watch, history, goals and body:** the ingest endpoint and the service-token Access
   application; workout mapping, merge and split; daily active energy; History and Trends;
   goals and streaks; the Body page; display units.
4. **Offline and saved foods:** the outbox and offline viewing; the signed-out flow;
   saved foods (`save_food`, the alias shortcut, the library screen).

---

## 18. Later versions

- **Blood test results:** a `lab_results` table, upload by photo or PDF (the Claude API
  reads PDFs), and a `get_lab_results` tool. The coach discusses out-of-range values and
  recommends seeing a doctor rather than diagnosing.
- Streaming coach replies.
- A native iOS companion app (HealthKit background delivery) replacing Health Auto Export.
- Voice transcription on the cluster.
- A weight goal; lean-mass-based BMR (Katch-McArdle) from scans; targets that adapt to the
  weight trend.
