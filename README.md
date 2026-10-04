# fitnessAI

A personal food and training logbook with an AI coach, installable on an iPhone
and running on a home Raspberry Pi cluster.

Tell the coach what you ate or did ("2 scrambled eggs and a coffee"), or send a
photo of the plate, and it logs each item with calories, macros, saturated fat,
sugars, salt, fluids, alcohol and food groups. Workouts get active calories,
muscles and the sport — tennis, gym, wakeboarding, kitesurfing or other — shown
as an icon. Daily targets come from your profile (Mifflin-St Jeor) and grow with
part of your exercise calories. The conversation lasts 48 hours; what you logged
stays.

Design: [`docs/superpowers/specs/2026-10-03-fitnessai-design.md`](docs/superpowers/specs/2026-10-03-fitnessai-design.md)
· Plans: [milestone 1](docs/superpowers/plans/2026-10-03-fitnessai-milestone-1.md),
[milestone 2](docs/superpowers/plans/2026-10-04-fitnessai-milestone-2.md)

## How it fits together

```
shared/   types and validation used by both sides
server/   Fastify API + SQLite (Drizzle), the Claude coach; Node 24 runs the TypeScript directly
web/      React PWA (Vite, Tailwind, TanStack Query), neumorphic design
k8s/      what Flux deploys to the cluster
```

One container serves the API and the built PWA at `fitness.minipi.net`, behind
Cloudflare Access. The database is one SQLite file on the `ssd` volume.

## Develop

```bash
nvm use            # Node 24
npm ci
npm run dev:server # http://localhost:8080, signed in as dev@localhost, data in .data/
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
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` | — (required in production) | Cloudflare Access verification; only `OWNER_EMAIL` gets in |
| `ANTHROPIC_API_KEY` | unset | Turns the coach on |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | `claude-opus-5-5` / `medium` | `claude-sonnet-5-5` roughly halves the cost |
| `DATA_DIR` | `./.data` | Database, photos and snapshots |
| `PORT` / `METRICS_PORT` | `8080` / `9464` | App and Prometheus ports |
| `COACH_BUDGET_MS` | `90000` | Time one coach message may take |
| `RETENTION_HOURS` | `48` | How long conversations and photos are kept (at most 8760) |
| `SNAPSHOT_KEEP` | `7` | Nightly snapshots kept |
| `DEV_AUTH_EMAIL` | unset | Development only (`NODE_ENV=development`): skips Access |

## Deploy

Merging to `main` runs `.github/workflows/ci.yaml`: verify, build a `linux/arm64`
image to `ghcr.io/yanbin-pan/fitnessai`, and commit the pinned tag to
`k8s/kustomization.yaml`. Flux (home-cluster `clusters/home/fitnessai.yaml`)
picks that commit up within a minute. Roll back by reverting the `Deploy …`
commit; CI ignores changes to that file, so the revert is not rebuilt.
Rolling back past milestone 2 needs the database moved back first (see
[Data, backups and restore](#data-backups-and-restore)).

Secrets live in `k8s/80-secrets.sops.yaml`, encrypted to the cluster's age key.
Edit with `sops k8s/80-secrets.sops.yaml` and push. The app reads them only when
it starts, so once Flux has applied the change, restart it:
`kubectl -n fitnessai rollout restart deploy/fitnessai`.

## Data, backups and restore

```
/data/db/fitness.db   the live database — never backed up (CACHEDIR.TAG)
/data/photos/         photos, deleted after 48 hours — never backed up (CACHEDIR.TAG)
/data/snapshots/      what the backups keep
```

- Every hour the app deletes messages, the coach's replies and photos once they
  are 48 hours old, and the coach's raw history for a day once that day has no
  messages left. Entries keep every number. A message the coach is still working
  on is left until it finishes.
- At 03:00 (profile timezone) the app writes `snapshots/fitness-YYYY-MM-DD.db`
  (keeps 7); a startup with a database migration to run first writes
  `startup-<time>.db` (keeps 3). Snapshots have the conversations removed.
- The cluster's restic job copies the volume to R2 at 03:30 with
  `--exclude-caches`, which skips the two tagged folders, so the backups hold
  only snapshots — never a chat or a photo.

To restore:

```bash
flux suspend kustomization fitnessai   # otherwise Flux scales the app back up
kubectl -n fitnessai scale deploy/fitnessai --replicas=0
# on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s:
sudo cp snapshots/fitness-YYYY-MM-DD.db db/fitness.db
sudo rm -f db/fitness.db-journal       # a journal left by a crash would be replayed into the copy
sudo chown 1000:1000 db/fitness.db     # the app runs as uid 1000
kubectl -n fitnessai scale deploy/fitnessai --replicas=1
flux resume kustomization fitnessai
```

**If an update fails to start.** A failed migration rolls back inside its own transaction,
so the database is unchanged: revert the update's `Deploy …` commit and the previous version
starts again. Restore the newest `startup-…` snapshot (as above) only if the migration
committed and the app still fails — for example on the foreign-key check.

**Rolling back to milestone 1.** Milestone 1 reads `/data/fitness.db`; milestone 2 moved it
into `db/`. Move it back first, in this order:

```bash
flux suspend kustomization fitnessai
kubectl -n fitnessai scale deploy/fitnessai --replicas=0
# on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s:
sudo mv db/fitness.db fitness.db
[ -e db/fitness.db-journal ] && sudo mv db/fitness.db-journal fitness.db-journal   # a journal travels with its database
# revert milestone 2's Deploy commit on main, then:
flux resume kustomization fitnessai
kubectl -n fitnessai scale deploy/fitnessai --replicas=1
```

Milestone 1 ignores the new columns and the photos table, but it keeps its database outside
`db/`, so backups hold its conversations again while it runs.

## On the iPhone

Open `https://fitness.minipi.net` in Safari, sign in, then Share → Add to Home
Screen. Voice input is the keyboard's microphone; the camera button beside the
text box takes or picks up to four photos. If the app shows "Signed out", tap
the banner to sign in again; the Access session lasts 30 days.

## Known issues

- The Access re-login test from milestone 1 (Cloudflare Zero Trust → Access →
  Applications → fitnessAI → Revoke existing tokens, then reopen the installed
  app) has not been run on the iPhone yet.
