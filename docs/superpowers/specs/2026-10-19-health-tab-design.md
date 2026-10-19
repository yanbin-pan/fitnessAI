# The Health Tab, Rebuilt — Design

The Health tab is where the person keeps everything about their health that the coach should take into account when it
talks about food and training: conditions, injuries, medications, allergies and diet, and the records behind them (blood
tests, scans, doctor's letters) photographed in any language. It replaces the 2026-10-12 health context design.

Chosen from the design canvas: home **A · Profile first**, with the conversation of **C** for adding things in your own
words. The coach never changes the profile on its own: everything it finds is a suggestion the person adds, edits or
dismisses.

## 1. Storage: a health database per person

- Each person gets `users/<key>/db/health.db`, beside `fitness.db`: same folder (tagged so restic skips it), same
  settings (exclusive lock, rollback journal, `secure_delete`), its own Drizzle schema (`server/src/db/health-schema.ts`)
  and migrations (`server/drizzle-health`, made with `npm run db:generate:health --workspace server`).
- Nightly snapshots: `health-<date>.db` next to `fitness-<date>.db`, with the health chat emptied (it is a
  conversation). A pending migration takes `health-startup-<stamp>.db` first, as `fitness.db` does.
- The schema is generic so a new kind of record or a new detail needs no migration:

| Table | Holds | Generic parts |
|---|---|---|
| `consent` | when the person agreed to keep records and share them with the coach | — |
| `documents` | one per record: blood test, scan, letter, prescription | `kind` is text; `details` is JSON |
| `observations` | one per measured value, linked to its document | `code` is text (`ldl`, …, `other`); value as number or words |
| `facts` | what the coach should know: condition, injury, medication, allergy, intolerance, diet, food rule, target, note | `kind`, `code` and `level` are text; `details` is JSON |
| `suggestions` | facts the coach found, waiting for the person's OK | the fact as JSON |
| `chat` | the Health chat (§4) | `details` is JSON |

- Kinds and codes are validated in code (`shared/src/health.ts`), not by the database: adding `sleep_study` to the
  document kinds, or a `side` to an injury's details, is a code change only.
- A fact: `kind`, optional `code` (a known condition or diet, named in the app's language), `label` (the person's or the
  coach's words, always set), `detail`, `level` for foods (`never`, `limit`, `avoid`, `prefer`), `status` (`active`,
  `resolved`), `started_on`, `ended_on`, `shared` (the coach sees it), and the document it came from.
- **Moving in**: the first start opens `health.db`, copies the old tables of `fitness.db` (`health_consent`,
  `health_conditions`, `medications`, `lab_reports`, `lab_results`) into it with their ids, then migration 0013 drops
  them. The copy is idempotent, so a crash between the two repeats it harmlessly; the startup snapshot keeps the old
  rows. Old conditions become diets, allergies (`never`), intolerances (lactose `limit`, coeliac `never`) or conditions.
- "Delete my health data" empties every table of `health.db`.

## 2. Reading a record

`POST /api/records/read` with up to 4 photos. Claude (the insights' model, medium effort) returns the record's kind,
title, date, source, language, a short plain summary of what is written (never a diagnosis beyond the record's own
words), every measured value with its printed range, and facts the record states (a diagnosis, a prescribed medicine, an
injury, advice such as "less saturated fat"). Photos are deleted once read, as before.

The person checks it on one sheet (date, source, values, and each found fact with a checkbox) and saves:
`POST /api/records/documents`. Unticked facts stay on the record as suggestions, with an Add button on its page.

## 3. The home (A)

Top to bottom: **Tell your coach** (a box that opens the chat with the sentence, Scan a record, Upload file); **Waiting
for your OK** while suggestions are pending; **Your health profile** as four tiles (Conditions, Injuries, Medications,
Diet & allergies) opening their lists; **Coach is watching**: the latest result outside its range, opening its trend;
**Records**: the latest three, then All.

Screens behind it: the chat; all records with a filter by kind; a record (summary, values outside the range as range bars,
the rest folded, suggestions); a marker (§5); a list per profile section (resolve, edit, delete; add through the chat);
Diet & allergies (diet chips, foods by level, daily targets); What your coach sees (the exact facts, a switch on each,
export and delete).

## 4. The chat (C)

- `POST /api/records/chat` with text and/or photos. Photos are read as in §2 and the reply carries the read for "Check
  and save". Text goes to the coach's model with the person's facts, latest results and the chat so far; it answers
  briefly and returns **proposals**: facts to add, each a suggestion with Add / Not now, or ticked boxes with "Add 2 to
  profile" when there are several. It may ask one question with up to three tap-to-answer replies.
- Added suggestions show as one line with Undo. Nothing reaches `facts` without a tap.
- The chat is a conversation: it is deleted with the Today chats once older than the chat window (today and the 3 days
  before), pending chat suggestions with it, and never backed up.

## 5. Results and food

A marker's page shows its values across records against the printed range and, under it, the monthly average of the
nutrient it relates to from the food log: saturated fat for LDL and total cholesterol, added sugar for HbA1c, glucose and
triglycerides, iron for ferritin, iron and haemoglobin, vitamin D and B12 for theirs, and the foods that gave most of it
in the last 90 days. It is a picture of the two side by side, not a claim that one caused the other.

## 6. What the coach sees

Every coach message and the weekly insights get, once the person has agreed: active shared facts by kind (conditions,
injuries, current and stopped medications, diets, food rules by level, targets, notes), the latest blood test's results
outside their range with how they moved, and the summaries of the five latest other records. The coach respects levels
(`never`: never suggest, mention once if logged; `limit`: small amounts; `avoid`: leave out where easy; `prefer`: choose
more often), adapts training to injuries, steers towards targets, and says so when the week's log runs against an
out-of-range result. It cannot change the profile; told about a condition in the Today chat, it suggests adding it on
the Health tab.

## 7. Not in this round

Keeping the original photos to view later; a dark-mode pass of the new cards beyond the shared tokens; sharing records
with a doctor.
