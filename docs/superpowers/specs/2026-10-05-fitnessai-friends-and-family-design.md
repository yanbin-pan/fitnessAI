# fitnessAI — Friends and family (milestone 2.2) — Design

| | |
|---|---|
| **Date** | 2026-10-05 |
| **Status** | Approved by the owner, section by section. Built in milestone 2.2 and folded into the main design as revision 5. |
| **Amends** | [`2026-10-03-fitnessai-design.md`](2026-10-03-fitnessai-design.md) (revision 4). The plan folds these changes into it as revision 5. |
| **Reference** | tea-cabinet's multi-tenancy design (`docs/superpowers/specs/2026-08-11-multi-tenancy-design.md` in that repository): one folder per person, keyed by a hash of the verified email. |

---

## 1. Summary

The owner opens fitnessAI to a handful of invited friends and family for testing. Each person
is a separate user whose data nobody else can see — the owner included. Everyone gets the
whole app, the coach too, with a daily limit on coach calls for guests. Data is kept exactly
as the owner's is: conversations and photos for 48 hours, every logged number for good, and
conversation-free snapshots that the cluster backs up.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| F1 | **One database per person**: a folder per person, named by a hash of their email, holding their own SQLite database, photos and snapshots | Separation by construction: every existing query works unchanged on "this person's database", and no forgotten filter can show one person another's data. The rejected alternative, a user column on every table, touches every query and two primary keys (`days`, `coach_threads`), and one missed condition leaks someone's health notes. |
| F2 | Sign-in stays Cloudflare Access with a one-time code; the app trusts only the email in the verified token | Unchanged from milestone 1 (§13). |
| F3 | Two allowlists: `fitness_emails` in Cloudflare Access, and `ALLOWED_EMAILS` in the app's encrypted secret | Defence in depth, as today: a loosened Access policy still lets nobody in who isn't on the app's list. |
| F4 | People are added and removed by changing the lists (no admin screen) | A handful of testers; no new attack surface. |
| F5 | Everyone gets the coach; each person has a daily cap on model calls — the owner `AI_DAILY_CALL_CAP` (200), guests `GUEST_DAILY_CALL_CAP` (60) | Every coach call is billed to the owner's Anthropic key; the cap bounds what one guest can cost (about 20–30 messages a day). |
| F6 | The editor's featured row is each person's four most-logged activities over the last 60 days, filled from a starter set | The owner's four sports mean nothing to a friend who only runs. |
| F7 | Nobody, the owner included, sees anyone else's data in the app | The owner's request: individual users, no sharing yet. |

## 3. Identity

- The identity is the `email` claim of the verified `Cf-Access-Jwt-Assertion` — signature by
  `kid`, issuer, audience `ACCESS_AUD`, expiry — lowercased and trimmed, exactly as today. The
  `Cf-Access-Authenticated-User-Email` header is never read.
- **Who's allowed:** `OWNER_EMAIL` plus every address in `ALLOWED_EMAILS` (comma-separated,
  compared lowercased and trimmed; empty or unset means the owner alone). Anyone else gets the
  same bodiless `401` as an unsigned request, so the list can't be probed by comparing answers.
- Each person's **key** is `sha256(email)` in lowercase hex. A request carries `{ email, key,
  owner }`; no email or other user-supplied string ever becomes part of a file path.
- `OWNER_EMAIL` stays required at startup; `ALLOWED_EMAILS` is optional.
- The Apple Health ingest (milestone 4) stays the owner's: its service token maps to the
  owner's database.

## 4. Storage

```
/data/users/<key>/db/fitness.db        the person's database (+ its journal)
/data/users/<key>/db/CACHEDIR.TAG      backups skip the live database
/data/users/<key>/photos/              the person's photos (+ CACHEDIR.TAG)
/data/users/<key>/snapshots/           conversation-free copies — what restic keeps
```

- A **registry** opens a person's database on their first request, with the settings and the
  migration routine `openDatabase` uses today (exclusive locking, rollback journal,
  `secure_delete`, `journal_size_limit = 0`, the foreign-key check, a startup snapshot before a
  pending migration into that person's `snapshots/`), and keeps it open for the life of the
  process. A guest's database starts empty; the existing setup screen asks for their profile.
- Every route takes the database and photo folder from the request's person instead of from
  the app's dependencies. The code below the routes keeps its current signatures — it already
  takes a database and a folder as arguments.
- Photos are served only from the requester's own folder: someone else's photo id is a `404`.
- **The owner's data moves once.** On the first start of milestone 2.2, if `/data/db/fitness.db`
  exists and the owner's folder doesn't, the app moves `db/` (database and journal together),
  `photos/` and `snapshots/` into `users/<owner key>/`, after a snapshot. It never overwrites,
  and a second start finds nothing to move — the same pattern as milestone 2's move into `db/`.
- Disk: each person adds a small database and at most 48 hours of photos to the shared volume.
  NFS enforces no quota; for a handful of people this is accepted and watched by the existing
  filesystem alert.

## 5. Background jobs

- The hourly retention job (minute 7, and once at startup) and the nightly snapshot (03:00)
  run for every person folder under `/data/users/`, one after another, with today's rules: 48
  hours for messages, replies and photos; entries keep every number; snapshots without
  conversations; `SNAPSHOT_KEEP` snapshots per person.
- One person's failure is logged (with the first 8 characters of their key) and the loop goes
  on to the next person.

## 6. The coach's daily cap

- Each database gets the spec's `ai_usage` table (§5), plus a `calls` column: one row per
  coach run — on success and on failure, so calls that ended in an error still count — with
  the model, the tokens and the number of model calls. The table is kept when its message is
  deleted.
- Before the coach runs (§6.3, step 3), the app sums the person's `calls` for their local day.
  At or past their cap the message fails with `ai_cap`. A run that starts under the cap may
  finish a few calls over it (at most `MAX_MODEL_CALLS − 1`).
- The bubble says "Today's coach limit is used up. You can still add things by hand." Manual
  logging, the activities card and the calendar keep working; the cap resets at the person's
  local midnight, and Retry works again then.
- Caps: `AI_DAILY_CALL_CAP` for the owner (default 200, as §6.4 already says) and
  `GUEST_DAILY_CALL_CAP` for everyone else (default 60).

## 7. The featured row

- The day view gains `featured`: the person's four activities with the most exercise items
  over the 60 days ending on the viewed day, ties broken by the most recent. Fewer than four
  are filled from a starter set, skipping repeats — the owner's is tennis, gym, wakeboarding,
  kitesurfing; everyone else's is running, walking, cycling, gym.
- The editor's picker shows `featured` (plus the exercise's own activity when it isn't one of
  them) instead of the fixed four, and the More grid's first family, "Your sports", lists the
  same four.

## 8. Privacy and logs

- Logs never contain an email. Where a job has to name a person it uses the first 8 hex
  characters of their key. Metrics carry no per-person labels.
- Guests' entries and photos live on the owner's home server, and their messages go to
  Anthropic under the owner's account. The README carries a short note for invitees saying so,
  and that conversations are deleted after 48 hours while the numbers are kept.

## 9. Operations

- **Adding someone:** their email goes into `ALLOWED_EMAILS` in `k8s/80-secrets.sops.yaml`
  (only the encrypted form is committed) and into `fitness_emails` in home-cluster's local
  `terraform/cloudflare/terraform.tfvars` (never committed). `terraform apply` changes Cloudflare
  — the owner approves each apply or runs it — and Flux redeploys the app with the new list.
  The person opens the site, signs in with the emailed code, adds it to their home screen and
  sets up their profile.
- **Removing someone:** take the email out of both lists; they can no longer sign in. Their
  folder stays until the owner deletes it — one documented command on the server — and their
  snapshots age out of the backups under the 6-month retention, or are pruned sooner.
- **Rolling back to a single user:** move `users/<owner key>/db`, `photos` and `snapshots` back
  to `/data/` before reverting (README).

## 10. Testing

- **Separation:** two people each set up a profile, log food and exercise, message the coach
  (fake AI) and upload photos; neither can see the other's days, entries, messages, calendar
  summaries or photos — including by requesting the other's photo id — and each person's
  database holds only their own rows.
- **Allowlist:** a correctly signed token for an email not on the list gets `401` with no body;
  the owner and every listed guest get in; listing compares case-insensitively.
- **The move:** a milestone 2.1 data folder moves into the owner's folder with identical counts
  and a snapshot first; a second start moves nothing; an existing owner folder is never
  overwritten.
- **Jobs:** retention and snapshots run for each person, and one person's failure doesn't stop
  the others.
- **Cap:** a guest is refused at 60 calls and the owner at 200 (`ai_cap`, no AI call made);
  failed runs count; the count resets at the person's local midnight; the bubble's words.
- **Featured row:** the most-logged four, ties by recency, the starter fill for owner and guest.
- **Live check before merging:** two local test users side by side in the browser, with the
  owner's key on a throwaway data folder.

## 11. Later

Sharing between people; an admin page; per-person Apple Health tokens; per-person models or
budgets beyond the daily cap; disk quotas.
