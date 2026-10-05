# fitnessAI

A personal food and training logbook with an AI coach, installable on an iPhone
and running on a home Raspberry Pi cluster.

Tell the coach what you ate or did ("2 scrambled eggs and a coffee"), or send a
photo of the plate, and it logs each item with calories, macros, saturated fat,
sugars, salt, fluids, alcohol and food groups. Workouts get active calories,
muscles and one of 33 activities — from tennis, gym, wakeboarding and
kitesurfing to street photography, cycling and boxing — shown as a matte badge.
Daily targets come from your profile (Mifflin-St Jeor) and grow with part of
your exercise calories. The conversation lasts 48 hours; what you logged stays.

Design: [`docs/superpowers/specs/2026-10-03-fitnessai-design.md`](docs/superpowers/specs/2026-10-03-fitnessai-design.md),
[`docs/superpowers/specs/2026-10-05-fitnessai-friends-and-family-design.md`](docs/superpowers/specs/2026-10-05-fitnessai-friends-and-family-design.md)
· Plans: [milestone 1](docs/superpowers/plans/2026-10-03-fitnessai-milestone-1.md),
[milestone 2](docs/superpowers/plans/2026-10-04-fitnessai-milestone-2.md),
[milestone 2.1](docs/superpowers/plans/2026-10-04-fitnessai-milestone-2-1.md),
[milestone 2.2](docs/superpowers/plans/2026-10-05-fitnessai-milestone-2-2.md)

## How it fits together

```
shared/   types and validation used by both sides
server/   Fastify API + SQLite (Drizzle), the Claude coach; Node 24 runs the TypeScript directly
web/      React PWA (Vite, Tailwind, TanStack Query), neumorphic design
k8s/      what Flux deploys to the cluster
```

One container serves the API and the built PWA at `fitness.minipi.net`, behind
Cloudflare Access. Each person has a SQLite database of their own on the `ssd`
volume.

## Develop

```bash
nvm use            # Node 24
npm ci
npm run dev:server # http://localhost:8080, signed in as dev@localhost (the owner), data in .data/
npm run dev:web    # http://localhost:5173, proxies /api to the server
```

Export `ANTHROPIC_API_KEY` before `npm run dev:server` to switch the coach on
(photos need it too); without it, manual logging still works.

```bash
npm test           # every workspace
npm run typecheck
npm run lint
npm run db:generate  # after changing server/src/db/schema.ts; commit the new migration
npm run icons --workspace web  # after changing web/public/logo.svg
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` | — (required in production) | Cloudflare Access verification; `OWNER_EMAIL` is the owner |
| `ALLOWED_EMAILS` | unset (the owner alone) | Friends and family who may also sign in, comma-separated (see [Friends and family](#friends-and-family)) |
| `AI_DAILY_CALL_CAP` / `GUEST_DAILY_CALL_CAP` | `200` / `60` | Claude calls a day for the owner / for each guest |
| `ANTHROPIC_API_KEY` | unset | Turns the coach on |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | `claude-opus-5-5` / `medium` | `claude-sonnet-5-5` roughly halves the cost |
| `DATA_DIR` | `./.data` | Everyone's databases, photos and snapshots |
| `PORT` / `METRICS_PORT` | `8080` / `9464` | App and Prometheus ports |
| `COACH_BUDGET_MS` | `90000` | Time one coach message may take |
| `RETENTION_HOURS` | `48` | How long conversations and photos are kept (at most 8760) |
| `SNAPSHOT_KEEP` | `7` | Nightly snapshots kept per person |
| `DEV_AUTH_EMAIL` | unset | Development only (`NODE_ENV=development`): skips Access |

## Deploy

Merging to `main` runs `.github/workflows/ci.yaml`: verify, build a `linux/arm64`
image to `ghcr.io/yanbin-pan/fitnessai`, and commit the pinned tag to
`k8s/kustomization.yaml`. Flux (home-cluster `clusters/home/fitnessai.yaml`)
picks that commit up within a minute. Roll back by reverting the `Deploy …`
commit; CI ignores changes to that file, so the revert is not rebuilt.
Rolling back past milestone 2.2 or 2 needs the data moved back first (see
[Data, backups and restore](#data-backups-and-restore)); roll back one milestone
at a time, newest first.

Rolling back past milestone 2.1 also needs its new activities filed back under
`other`, or milestone 2 shows a blank page on any day with one. Roll back to
milestone 2.1 first (see [Data, backups and restore](#data-backups-and-restore)):
the command below reads `db/fitness.db`, where milestone 2.1 keeps its database.
With Flux suspended and the app scaled to 0 (as in the restore steps), run this
on rpi-01 in the PVC's directory (`sudo apt install sqlite3` if it's missing):

```bash
sudo sqlite3 db/fitness.db "UPDATE exercise_items SET activity = 'other' WHERE activity NOT IN ('tennis', 'gym', 'wakeboarding', 'kitesurfing', 'other');"
```

Then revert the `Deploy …` commit.

Secrets live in `k8s/80-secrets.sops.yaml`, encrypted to the cluster's age key.
Edit with `sops k8s/80-secrets.sops.yaml` and push. The app reads them only when
it starts, so once Flux has applied the change, restart it:
`kubectl -n fitnessai rollout restart deploy/fitnessai`.

## Friends and family

Each person signs in with their own email and gets the whole app, with a database of
their own that nobody else sees — the owner included. Guests get the coach too, up to
`GUEST_DAILY_CALL_CAP` calls a day (about 20–30 messages); every call is billed to the
owner's Anthropic key.

**Adding someone** — both lists, because the app checks its own as well as Cloudflare's:

1. `sops k8s/80-secrets.sops.yaml` and add the email to `ALLOWED_EMAILS`
   (comma-separated). Commit and push only the encrypted file.
2. In home-cluster, add it to `fitness_emails` in `terraform/cloudflare/terraform.tfvars`
   (never committed) and run `terraform apply` there.
3. Once Flux has applied the secret, restart the app:
   `kubectl -n fitnessai rollout restart deploy/fitnessai`.
4. They open <https://fitness.minipi.net>, sign in with the emailed code, add it to
   their home screen and set up their profile.

A malformed `ALLOWED_EMAILS` entry stops the app from starting until the secret is fixed
(the log names the entry's position, never the address); an invitee stuck on "Signed out"
is on only one list, or the app wasn't restarted.

**Removing someone:** take the email out of both lists — `sops k8s/80-secrets.sops.yaml`
for `ALLOWED_EMAILS`, and `fitness_emails` plus `terraform apply` in home-cluster — and
restart the app once Flux has applied the secret (a restart before that keeps the old
list). They can no longer sign in. Their folder stays until you delete it — on rpi-01, in
the PVC's directory (look at `ls users/` first, if you like):

```bash
key=$(printf %s 'friend@example.com' | sha256sum | cut -d' ' -f1); sudo rm -rf -- "users/${key:?}"
```

The email goes in lowercase, because the app lowercases it before hashing, and `${key:?}`
stops the command if the key comes out empty, so it can never become `rm -rf users/`.
Their snapshots age out of the backups under the 6-month retention.

**For invitees** (send this with the invite): your entries, photos and coach
conversations are stored on the owner's home server, and what you send the coach goes to
Anthropic under the owner's account. Conversations and photos are deleted after 48
hours; the numbers you log are kept, and backed up off-site for up to six months.

## Data, backups and restore

```
/data/users/<key>/db/fitness.db   a person's live database — never backed up (CACHEDIR.TAG)
/data/users/<key>/photos/         their photos, deleted after 48 hours — never backed up (CACHEDIR.TAG)
/data/users/<key>/snapshots/      what the backups keep
```

`<key>` is the sha256 of the person's email in lowercase hex, and the app lowercases the
email before hashing it, so do the same:
`printf %s 'friend@example.com' | sha256sum | cut -d' ' -f1`. The owner's folder is the
sha256 of `OWNER_EMAIL`.

- Every hour the app deletes every person's messages, the coach's replies and
  photos once they are 48 hours old, and the coach's raw history for a day once
  that day has no messages left. Entries keep every number. A message the coach
  is still working on is left until it finishes.
- At 03:00 in the owner's timezone the app writes every person's
  `snapshots/fitness-YYYY-MM-DD.db`, named by that person's own local date (keeps 7); a
  startup with a database migration to run first writes `startup-<time>.db` (keeps 3).
  Snapshots have the conversations removed.
- The cluster's restic job copies the volume to R2 at 03:30 with
  `--exclude-caches`, which skips each person's two tagged folders, so the backups hold
  only snapshots — never a chat or a photo.

To restore:

```bash
flux suspend kustomization fitnessai   # otherwise Flux scales the app back up
kubectl -n fitnessai scale deploy/fitnessai --replicas=0
# on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s:
sudo cp users/<key>/snapshots/fitness-YYYY-MM-DD.db users/<key>/db/fitness.db
sudo rm -f users/<key>/db/fitness.db-journal     # a journal left by a crash would be replayed into the copy
sudo chown 1000:1000 users/<key>/db/fitness.db   # the app runs as uid 1000
kubectl -n fitnessai scale deploy/fitnessai --replicas=1
flux resume kustomization fitnessai
```

**If an update fails to start.** A failed migration rolls back inside its own transaction,
so the database is unchanged: revert the update's `Deploy …` commit and the previous version
starts again. Restore the newest `startup-…` snapshot (as above) only if the migration
committed and the app still fails — for example on the foreign-key check. The exception is
milestone 2.2: once its first start has moved the data, roll back with "Rolling back to
milestone 2.1" below (the data goes back first), not by only reverting the `Deploy …`
commit, or milestone 2.1 starts on a new, empty database.

**Rolling back to milestone 2.1.** Milestone 2.1 has one database at `/data/db/fitness.db`;
milestone 2.2 moved it, the photos and the snapshots into the owner's folder. Move them
back first. `<owner key>` is the sha256 of `OWNER_EMAIL`, worked out as above:

```bash
flux suspend kustomization fitnessai
kubectl -n fitnessai scale deploy/fitnessai --replicas=0
kubectl -n fitnessai wait --for=delete pod -l app=fitnessai --timeout=120s   # the pod holds the database's lock until it is gone
# on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s:
sudo mv users/<owner key>/db users/<owner key>/photos users/<owner key>/snapshots .
sudo test -f db/fitness.db   # stop here if this fails: milestone 2.1 would start on an empty database
sudo rmdir users/<owner key>   # must be empty now; a later roll-forward moves the data back in
# revert milestone 2.2's Deploy commit on main and push it, then fetch it before resuming,
# so Flux never re-applies milestone 2.2 to the moved data:
flux reconcile source git fitnessai
flux resume kustomization fitnessai
kubectl -n fitnessai scale deploy/fitnessai --replicas=1
```

Guests' folders stay in `users/`, untouched; milestone 2.1 ignores them, so while it
serves they get no 48-hour clean-up and no snapshots.

**Rolling back to milestone 1.** Milestone 1 reads `/data/fitness.db`; milestone 2 moved it
into `db/`. Roll back to milestone 2 first — milestone 2.2 to 2.1 (above), then 2.1 to 2,
which needs the activities 2.1 added filed back under `other` (see [Deploy](#deploy)) —
and then move the database back, in this order:

```bash
flux suspend kustomization fitnessai
kubectl -n fitnessai scale deploy/fitnessai --replicas=0
# on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s:
sudo mv db/fitness.db fitness.db
sudo test -e db/fitness.db-journal && sudo mv db/fitness.db-journal fitness.db-journal   # a journal travels with its database
# revert milestone 2's Deploy commit on main and push it, then fetch it before resuming,
# so Flux never re-applies milestone 2 to the moved database:
flux reconcile source git fitnessai
flux resume kustomization fitnessai
kubectl -n fitnessai scale deploy/fitnessai --replicas=1
```

That revert may stop on a conflict in `newTag` in `k8s/kustomization.yaml`, because the
later `Deploy …` commits changed the same line: resolve it to milestone 1's image tag, the
one the reverted commit replaced.

Milestone 1 ignores the new columns and the photos table, but it keeps its database outside
`db/`, so backups hold its conversations again while it runs.

## On the iPhone

Open `https://fitness.minipi.net` in Safari, sign in, then Share → Add to Home
Screen. Voice input is the keyboard's microphone; the camera button beside the
text box takes or picks up to four photos. If the app shows "Signed out", tap
the banner to sign in again; the Access session lasts 30 days.

The home-screen icon is the zabaione ball. iOS keeps the icon it saw when the
app was added, so after an icon change remove fitnessAI from the home screen
and add it again; your data lives on the server and is not touched.

## Known issues

- The Access re-login test from milestone 1 (Cloudflare Zero Trust → Access →
  Applications → fitnessAI → Revoke existing tokens, then reopen the installed
  app) has not been run on the iPhone yet.
