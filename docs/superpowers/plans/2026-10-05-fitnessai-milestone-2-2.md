# fitnessAI Milestone 2.2 — Friends and Family — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invited friends and family sign in with their own email and get the whole app, the coach included under a daily cap. Each person's data is visible to nobody else and is kept exactly as the owner's is. The release is deployed the same way as milestone 2.1.

**Architecture:**
- **Storage:** each person has their own SQLite database and photo folder under `/data/users/<sha256(email)>/`. A registry opens it with milestone 1's settings on first use and keeps it open.
- **Requests:** the sign-in hook attaches the person to every request. Each route then works from `forRequest(appDeps, req)`, which is the app's dependencies with that person's database and photos. The route code is otherwise unchanged.
- **Who's allowed:** the app keeps its own allowlist (`ALLOWED_EMAILS`) as well as Cloudflare Access's list.
- **Jobs:** retention and the nightly snapshot loop over the person folders.
- **The cap:** each database gets an `ai_usage` table that counts model calls for the daily cap.
- **The day view** carries each person's featured activities.

**Tech Stack:** Node 24 (TypeScript run directly), Fastify 5, Drizzle ORM 0.45 + better-sqlite3, Zod 4, Vitest; React 19, Tailwind 4, TanStack Query 5, Testing Library.

**Spec:**
- `docs/superpowers/specs/2026-10-05-fitnessai-friends-and-family-design.md` is the milestone 2.2 design and is binding.
- It amends `docs/superpowers/specs/2026-10-03-fitnessai-design.md` (revision 4). Task 7 folds 2.2 into it as revision 5.

**Starts from:**
- `main` after milestone 2.1 is merged and deployed. Work on a new branch, `m2.2-friends-and-family`.
- Code excerpts below are quoted from milestone 2.1's branch at `7276e1d`.
- 2.1's later tasks change `web/src/pages/TodayPage.tsx`, the composer, the feed and `README.md`, and its final review may tidy `server/src/routes/messages.ts`. Find the places named here by their code, not by line numbers.

## Global Constraints

**Toolchain and repository rules**
- Node 24 runs the TypeScript directly:
  - relative imports end in `.ts` or `.tsx`;
  - types come in through `import type`;
  - no enums, namespaces, parameter properties or other non-erasable syntax.
- Workspaces are `shared/`, `server/` and `web/`.
  - Per workspace: `npm test --workspace server` (or `shared`, `web`).
  - Whole repo: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. There is no per-workspace lint script.
- **No new runtime or dev dependencies** in any `package.json`.
- Schema changes go through drizzle-kit:
  - edit `server/src/db/schema.ts`;
  - run `npm run db:generate --workspace server -- --name=<name>`;
  - commit the generated SQL, snapshot and journal entry unedited.
  - Migrations run with foreign keys off.

**Identity and storage (2.2 §3–§4)**
- **Identity:** the `email` claim of the verified `Cf-Access-Jwt-Assertion`, lowercased and trimmed. The `Cf-Access-Authenticated-User-Email` header is never read.
- **Who's allowed:** `OWNER_EMAIL` plus every address in `ALLOWED_EMAILS` (comma-separated, compared lowercased and trimmed; empty or unset means the owner alone).
  - Anyone else gets the same bodiless `401` as an unsigned request.
  - `OWNER_EMAIL` stays required at startup; `ALLOWED_EMAILS` is optional.
- **Key:** each person's key is `sha256(email)` in lowercase hex. No email or other user-supplied string ever becomes part of a file path.
- **Layout:**
  - `/data/users/<key>/db/fitness.db` (and its journal)
  - `/data/users/<key>/db/CACHEDIR.TAG`
  - `/data/users/<key>/photos/` (and its `CACHEDIR.TAG`)
  - `/data/users/<key>/snapshots/`
- **Database settings:** every person's database keeps milestone 1's:
  - exclusive locking and the rollback journal;
  - `secure_delete` and `journal_size_limit = 0`;
  - the foreign-key check;
  - a startup snapshot into that person's `snapshots/` before a pending migration.
- **Photos** are served only from the requester's own folder. Someone else's photo id is a `404`.
- **The owner's data moves once:**
  - if `/data/db/fitness.db` exists and the owner's folder doesn't, `db/` (database and journal together), `photos/` and `snapshots/` move into `users/<owner key>/`;
  - it never overwrites, and a second start finds nothing to move.

**Jobs (2.2 §5)**
- Retention runs hourly at minute 7 and once at startup; the nightly snapshot runs at 03:00.
- Both run for every person folder, one after another, with today's rules: 48 hours, and `SNAPSHOT_KEEP` snapshots per person.
- One person's failure is logged with the first 8 characters of their key, and the loop goes on.

**The cap (2.2 §6)**
- `ai_usage` gets a `calls` column. It holds one row per coach run, on success and on failure, and the row is kept when its message is deleted.
- Before the coach runs, the person's `calls` for their local day are summed. At or past the cap, the message fails with `ai_cap`.
- A run that starts under the cap may finish at most `MAX_MODEL_CALLS − 1` calls over it.
- Caps: `AI_DAILY_CALL_CAP` for the owner (default 200) and `GUEST_DAILY_CALL_CAP` for everyone else (default 60).
- The bubble says exactly "Today's coach limit is used up. You can still add things by hand."
- The cap resets at the person's local midnight.

**The featured row (2.2 §7)**
- `featured` is the person's four activities with the most exercise items over the 60 days ending on the viewed day, ties broken by the most recent.
- Fewer than four are filled from a starter set, skipping repeats:
  - the owner's: `tennis, gym, wakeboarding, kitesurfing`;
  - everyone else's: `running, walking, cycling, gym`.
- The picker shows `featured` (plus the exercise's own activity when it isn't one of them). The More grid's first family, "Your sports", lists the same four.

**Privacy (2.2 §8)**
- Logs never contain an email. A job names a person by the first 8 hex characters of their key.
- Metrics carry no per-person labels.
- The standing rules still hold:
  - never log message text, photos, health values or step texts;
  - tests generate their own images;
  - nothing real is committed (the repository is public);
  - testers' emails live only in the SOPS-encrypted secret and in home-cluster's local `terraform.tfvars`.

**Behaviour that stays**
- Milestone 1, 2 and 2.1 behaviour stays for every person:
  - idempotent message ids;
  - staged coach writes committed in one transaction;
  - Retry, Undo and the live steps;
  - the calendar and back-dated linked entries;
  - 48-hour retention and the photo limits.

**Copy and commits**
- Copy: sentence case; contractions; no "please", "successfully" or "!" in system text.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes

The spec leaves these open. The executor records each as a ruling.

| # | Decision | Why |
|---|---|---|
| P1 | The verifier decides who's in and returns `{ email, owner }`. The development bypass signs its one person in as the owner. | One place answers "who is this", so nothing else can derive the guest flag wrongly. |
| P2 | Every existing person folder is opened at startup, before the app listens. A new person's folder is opened on their first request. | `openDatabase` waits synchronously (up to 2 minutes) for an old pod's NFS lock. That wait must happen at startup and never block the event loop inside a request. A brand-new folder has no lock to wait for. |
| P3 | Routes take `forRequest(appDeps, req)`: the app's dependencies with the person's `db` and `photoDir`. `AppDeps` loses `db` and `photoDir`. | Route bodies keep reading `deps.db`. The compiler then finds every place that still reaches for a shared database. |
| P4 | The move goes through `users/<owner key>.moving/` and ends with one rename. | A crash part-way leaves either the old layout or the staging folder, and the next start finishes either. It never leaves a half-filled owner's folder, which would make the owner look like a new person. |
| P5 | The move's snapshot is the startup snapshot `openDatabase` takes before migration 0003 (Task 5), written to the owner's `snapshots/`. | A rename changes no bytes. The first change to the data is the migration, and a snapshot is taken right before it. |
| P6 | Milestone 1's legacy move (`/data/fitness.db` → `/data/db/`) is removed. | No milestone 1 layout exists any more: milestone 2's deploy moved it on 2026-10-04. Keeping both moves would recreate empty top-level folders on every start. |
| P7 | `ai_usage.date` is the person's local date when the run starts. `model` is the model that last answered, or null when none did. `cost_usd_estimate` waits for milestone 3's cost display. | The cap counts calls on the day they're made, not the message's day: a Retry tomorrow of yesterday's message counts tomorrow. |
| P8 | `other` is never featured. | It isn't a sport, and the picker always shows an exercise's own activity anyway. |
| P9 | The More grid lists each activity once. "Your sports" holds the featured four, and the families below leave them out. Tennis joins Racket, wakeboarding and kitesurfing join Water, and gym joins the renamed "Gym, combat and mind". | One radio per activity in the radio group. And because the featured four now vary per person, every activity needs a family of its own. |
| P10 | A typo in `ALLOWED_EMAILS` is refused at startup by its position ("entry 2"), never by repeating the address. | A config error goes to the pod's log. |

## File map

| File | Task | Responsibility |
|---|---|---|
| `server/src/config.ts` | 1, 5 | `ALLOWED_EMAILS` and `ownerEmail` (1); the two caps (5) |
| `server/src/auth/access.ts` | 1 | `Identity.owner`; the allowlist |
| `server/src/db/location.ts` | 2, 3 | `personPaths`, `preparePersonDir`, `moveOwnerIn` (2); `prepareDataDir` removed (3) |
| `server/src/people/people.ts` | 2 | `personKey`, `shortKey`, `createPeople`: the registry of open databases |
| `server/src/jobs.ts` | 3 | the snapshot and retention jobs, run for every person |
| `server/src/main.ts` | 3, 4, 5 | startup: the move, opening everyone, serving |
| `server/src/deps.ts`, `server/src/app.ts`, `server/src/routes/*.ts` | 4 | `RequestDeps` and `forRequest`; the hook attaches the person; routes use the person's data |
| `server/src/db/schema.ts`, `server/drizzle/0003_ai_usage.sql`, `server/src/coach/usage.ts` | 5 | the `ai_usage` table; `recordRun`, `callsOn` |
| `server/src/coach/loop.ts`, `server/src/coach/process.ts` | 5, 6 | `LoopResult.model`; the cap and the usage rows (5); the coach's day view (6) |
| `server/src/days/featured.ts`, `server/src/days/days.ts`, `shared/src/api.ts` | 6 | `featuredActivities` and the starters; `DayView.featured` |
| `web/src/format.ts` | 5 | the `ai_cap` words |
| `web/src/components/SportBadge.tsx`, `web/src/components/EntryEditor.tsx`, `web/src/pages/TodayPage.tsx` | 6 | natural families and `familiesFor`; the picker's `featured` |
| `server/test/helpers.ts` | 1, 3, 4, 5 | `makeAccess(owner, allowed)`, `testPeople`, `testApp` over a registry, `TEST_CAPS` |
| `README.md`, `k8s/30-app.yaml`, the two specs | 7 | docs, environment, revision 5 |

---

### Task 1: Who's allowed in

**Files:**
- Modify: `server/src/config.ts`, `server/src/auth/access.ts`, `server/test/helpers.ts`
- Test: `server/test/config.test.ts`, `server/test/auth.test.ts`, `server/test/logging.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `AccessConfig.allowedEmails: readonly string[]`
  - `Config.ownerEmail: string` — `OWNER_EMAIL`, or `DEV_AUTH_EMAIL` when development skips Access
  - `Identity { email: string; owner: boolean }`
  - `AuthError` message `"not on the list"`
  - `makeAccess(ownerEmail = "owner@example.com", allowedEmails: string[] = [])`

Until Task 4, a guest who signs in would reach the one shared database. That's harmless: nothing deploys between tasks, and `ALLOWED_EMAILS` is set nowhere until Task 9. So this task tests guests at the verifier only.

- [ ] **Step 1: Write the failing tests**

In `server/test/config.test.ts`, the first test gains the new fields. Replace its `expect(c.access)` line with:

```ts
    expect(c.access).toEqual({ teamDomain: "team.cloudflareaccess.com", audience: "aud", ownerEmail: "owner@example.com", allowedEmails: [], testJwks: null });
    expect(c.ownerEmail).toBe("owner@example.com");
```

Then add these tests inside `describe("loadConfig", …)`:

```ts
  it("lets in the addresses on ALLOWED_EMAILS: trimmed, lowercased, each once, the owner left out", () => {
    const c = loadConfig({ ...production, ALLOWED_EMAILS: " Friend@Example.com, mum@example.com,,friend@example.com , OWNER@example.com " });
    expect(c.access?.allowedEmails).toEqual(["friend@example.com", "mum@example.com"]);
    expect(loadConfig({ ...production, ALLOWED_EMAILS: "  " }).access?.allowedEmails).toEqual([]);
  });

  it("refuses an ALLOWED_EMAILS entry that isn't an address, by its position and without repeating it", () => {
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com mum@example.com" })).toThrow(
      /^ALLOWED_EMAILS entry 1 is not an email address$/,
    );
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com;mum@example.com" })).toThrow(
      /^ALLOWED_EMAILS entry 1 is not an email address$/,
    );
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com, mum" })).toThrow(/^ALLOWED_EMAILS entry 2 is not an email address$/);
    expect(() => loadConfig({ ...production, ALLOWED_EMAILS: "friend@example.com, mum" })).toThrow(ConfigError);
  });

  it("makes the development sign-in the owner", () => {
    expect(loadConfig({ NODE_ENV: "development", DEV_AUTH_EMAIL: "Dev@Localhost" }).ownerEmail).toBe("dev@localhost");
    expect(loadConfig({ ...production, NODE_ENV: "development", DEV_AUTH_EMAIL: "dev@localhost" }).ownerEmail).toBe("dev@localhost");
  });
```

In `server/test/auth.test.ts`:

1. The first test's expectation becomes `expect(identity).toEqual({ email: "owner@example.com", owner: true });`.
2. Rename "rejects anyone who is not the owner, even with a valid token" to "rejects anyone not on the list, even with a valid token". Its body stays the same.
3. The existing `devVerifier` test now expects `{ email: <its email>, owner: true }`.
4. Add:

```ts
  it("lets in a guest on the list, whatever the email's case, as a guest", async () => {
    const auth = await makeAccess("owner@example.com", ["friend@example.com"]);
    const identity = await auth.verifier.verify(await auth.token({ email: " Friend@Example.COM " }));
    expect(identity).toEqual({ email: "friend@example.com", owner: false });
    await expect(auth.verifier.verify(await auth.token({ email: "mum@example.com" }))).rejects.toThrow("not on the list");
  });
```

In `server/test/logging.test.ts`:
- Rename "says an intruder is not the owner without logging any email address" to "says an intruder is not on the list without logging any email address".
- Its `toContain('"detail":"not the owner"')` becomes `toContain('"detail":"not on the list"')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test --workspace server -- config auth logging`.

Expected: FAIL. `allowedEmails` and `ownerEmail` are missing, the identity has no `owner`, and `makeAccess` ignores its second argument.

- [ ] **Step 3: Implement**

`server/src/config.ts`:

1. Add `allowedEmails` to `AccessConfig`, after `ownerEmail`:

   ```ts
     /** Everyone else who may sign in (ALLOWED_EMAILS), lowercased, the owner left out; empty means the owner alone (2.2 §3). */
     allowedEmails: readonly string[];
   ```

2. Add `ownerEmail` to `Config`, after `devAuthEmail`:

   ```ts
     /** The owner: OWNER_EMAIL, or DEV_AUTH_EMAIL when development skips Access (2.2 §3). */
     ownerEmail: string;
   ```

3. Add this helper after `positiveInt`:

   ```ts
   /** A comma-separated list of addresses, lowercased and trimmed, each once. A bad entry is named by its position:
    * the error goes to the pod's log, which never holds an email (2.2 §8). */
   function emailList(env: Env, name: string): string[] {
     const emails: string[] = [];
     for (const [index, part] of (env[name] ?? "").split(",").entries()) {
       const email = part.trim().toLowerCase();
       if (!email) continue;
       if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new ConfigError(`${name} entry ${index + 1} is not an email address`);
       if (!emails.includes(email)) emails.push(email);
     }
     return emails;
   }
   ```

4. In `loadConfig`, the `access` assignment becomes:

   ```ts
       const allowedEmails = emailList(env, "ALLOWED_EMAILS").filter((email) => email !== ownerEmail);
       access = { teamDomain, audience, ownerEmail, allowedEmails, testJwks: nodeEnv === "production" ? null : trimmed(env, "ACCESS_TEST_JWKS") };
   ```

5. Just before `return`, add:

   ```ts
     // The development bypass signs its one person in as the owner; otherwise the owner is OWNER_EMAIL.
     const owner = devAuthEmail ?? access?.ownerEmail ?? null;
     if (owner === null) throw new ConfigError("OWNER_EMAIL must be set"); // unreachable: refused above already
   ```

6. Add `ownerEmail: owner,` to the returned object, after `devAuthEmail`.

`server/src/auth/access.ts`:

1. `Identity` becomes:

   ```ts
   export interface Identity {
     email: string;
     /** The owner (OWNER_EMAIL); everyone else on ALLOWED_EMAILS is a guest (2.2 §3). */
     owner: boolean;
   }
   ```

2. In `createVerifier`, replace the owner check (the comment line and the `if (email !== access.ownerEmail)` line) and the `return` with:

   ```ts
         // Even if the Access policy is ever loosened, only the people on the app's own list get in (2.2 F3).
         const owner = email === access.ownerEmail;
         if (!owner && !access.allowedEmails.includes(email)) throw new AuthError("not on the list");
         return { email, owner };
   ```

3. `devVerifier`'s `verify` becomes:

   ```ts
       async verify() {
         // The development bypass has one person, and they are the owner.
         return { email, owner: true };
       },
   ```

`server/test/helpers.ts`, in `makeAccess`:
- The signature becomes `export async function makeAccess(ownerEmail = "owner@example.com", allowedEmails: string[] = [])`.
- The `access` object gains `allowedEmails,` after `ownerEmail,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test --workspace server -- config auth logging`. Expected: PASS.

Then run the whole server suite, `npm test --workspace server`, plus root `npm run typecheck` and `npm run lint`. Expected: all green; `app.test.ts`'s intruder still gets a bodiless 401.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/auth/access.ts server/test/helpers.ts server/test/config.test.ts server/test/auth.test.ts server/test/logging.test.ts
git commit -m "feat(server): an allowlist — the owner and ALLOWED_EMAILS sign in, everyone else gets the bare 401

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A folder and a database per person

**Files:**
- Modify: `server/src/db/location.ts`. Add to it; `prepareDataDir` stays until Task 3.
- Create: `server/src/people/people.ts`, `server/test/people.test.ts`
- Test: `server/test/datadir.test.ts`. Add two `describe` blocks.

**Interfaces:**
- Consumes: `Identity` (Task 1); `openDatabase`, `snapshotPartFile`, `failInterrupted`, `CACHEDIR_TAG` (existing).
- Produces:

```ts
// server/src/db/location.ts
export interface PersonPaths { dir: string; dbFile: string; photoDir: string; snapshotDir: string }
export function personPaths(dataDir: string, key: string): PersonPaths
export function preparePersonDir(dataDir: string, key: string): PersonPaths
export type OwnerMove = "none" | "moved" | "both";
export function moveOwnerIn(dataDir: string, ownerKey: string): OwnerMove
// server/src/people/people.ts
export function personKey(email: string): string
export function shortKey(key: string): string
export interface Store { key: string; db: Sql; sqlite: Database.Database; photoDir: string; snapshotDir: string }
export interface Person { key: string; owner: boolean; db: Sql; photoDir: string }
export interface People { personFor(identity: Identity): Person; store(key: string): Store; keys(): string[]; close(): void }
export function createPeople(opts: { dataDir: string }): People
```

Test vectors:
- `personKey("owner@example.com")` = `c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351`
- `personKey("friend@example.com")` = `f387373a9f44e7b317f6dc3f28e1807788ca174c44c247745fffaafbacb04bbe`

- [ ] **Step 1: Write the failing tests**

Create `server/test/people.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHEDIR_TAG } from "../src/db/location.ts";
import { insertEntry, listEntries } from "../src/log/entries.ts";
import { getMessage, insertUserMessage } from "../src/messages/messages.ts";
import { createPeople, personKey, shortKey } from "../src/people/people.ts";
import { NOW, sampleEntry, tempDir } from "./helpers.ts";

const OWNER_KEY = "c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351";
const FRIEND_KEY = "f387373a9f44e7b317f6dc3f28e1807788ca174c44c247745fffaafbacb04bbe";
const owner = { email: "owner@example.com", owner: true };
const friend = { email: "friend@example.com", owner: false };

describe("personKey", () => {
  it("is the sha256 of the email in lowercase hex, and shortKey its first 8 characters", () => {
    expect(personKey("owner@example.com")).toBe(OWNER_KEY);
    expect(personKey("friend@example.com")).toBe(FRIEND_KEY);
    expect(shortKey(OWNER_KEY)).toBe("c8cd3c64");
  });
});

describe("createPeople", () => {
  it("opens a person's database on first use, in their own folder laid out for backups, and keeps it open", () => {
    const dataDir = tempDir();
    const people = createPeople({ dataDir });
    const store = people.store(OWNER_KEY);
    const dir = path.join(dataDir, "users", OWNER_KEY);
    expect(store).toMatchObject({ key: OWNER_KEY, photoDir: path.join(dir, "photos"), snapshotDir: path.join(dir, "snapshots") });
    expect(fs.existsSync(path.join(dir, "db", "fitness.db"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "db", "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.readFileSync(path.join(dir, "photos", "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.existsSync(path.join(dir, "snapshots", "CACHEDIR.TAG"))).toBe(false);
    expect(people.store(OWNER_KEY)).toBe(store);
    people.close();
  });

  it("gives each person a database and a photo folder of their own", () => {
    const people = createPeople({ dataDir: tempDir() });
    const a = people.personFor(owner);
    const b = people.personFor(friend);
    expect(a).toMatchObject({ key: OWNER_KEY, owner: true });
    expect(b).toMatchObject({ key: FRIEND_KEY, owner: false });
    insertEntry(a.db, sampleEntry({ id: "owners" }), NOW.toISOString());
    expect(listEntries(a.db, "2026-10-03").map((e) => e.id)).toEqual(["owners"]);
    expect(listEntries(b.db, "2026-10-03")).toEqual([]);
    expect(b.photoDir).not.toBe(a.photoDir);
    people.close();
  });

  it("marks a message the last run left pending as interrupted when it opens a database", () => {
    const dataDir = tempDir();
    const first = createPeople({ dataDir });
    insertUserMessage(first.store(FRIEND_KEY).db, {
      id: "m1", date: "2026-10-03", text: "eggs", photoIds: [], sentAt: NOW.toISOString(), nowIso: NOW.toISOString(),
    });
    first.close();
    const second = createPeople({ dataDir });
    expect(getMessage(second.store(FRIEND_KEY).db, "m1")).toMatchObject({ status: "failed", error_code: "interrupted" });
    second.close();
  });

  it("lists the folders named by a key, and nothing else", () => {
    const dataDir = tempDir();
    const people = createPeople({ dataDir });
    expect(people.keys()).toEqual([]); // no users/ yet
    people.store(FRIEND_KEY);
    people.store(OWNER_KEY);
    const users = path.join(dataDir, "users");
    fs.mkdirSync(path.join(users, `${OWNER_KEY}.moving`));
    fs.mkdirSync(path.join(users, "not-a-key"));
    fs.writeFileSync(path.join(users, "a".repeat(64)), "a file, not a folder");
    expect(people.keys()).toEqual([OWNER_KEY, FRIEND_KEY].sort());
    people.close();
  });

  it("refuses a key that is not a hash", () => {
    const people = createPeople({ dataDir: tempDir() });
    for (const key of ["../db", "", OWNER_KEY.toUpperCase(), `${OWNER_KEY}.moving`]) {
      expect(() => people.store(key)).toThrow("not a person key");
    }
    people.close();
  });
});
```

In `server/test/datadir.test.ts`:
- Extend the location import to `import { CACHEDIR_TAG, moveOwnerIn, personPaths, prepareDataDir, preparePersonDir } from "../src/db/location.ts";`.
- After the `prepareDataDir` block, add:

```ts
const KEY = "c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351";

/** Milestone 2.1's layout: one person's db/, photos/ and snapshots/ at the top of the data folder. */
function singlePersonFolder(): string {
  const dir = tempDir();
  for (const name of ["db", "photos", "snapshots"]) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, "db", "CACHEDIR.TAG"), CACHEDIR_TAG);
  fs.writeFileSync(path.join(dir, "photos", "CACHEDIR.TAG"), CACHEDIR_TAG);
  const old = openDatabase({ file: path.join(dir, "db", "fitness.db"), snapshotDir: null });
  insertEntry(old.db, sampleEntry({ id: "a" }), NOW.toISOString());
  insertEntry(old.db, sampleEntry({ id: "b" }), NOW.toISOString());
  old.close();
  fs.writeFileSync(path.join(dir, "photos", `${"1".repeat(32)}.jpg`), "a photo");
  fs.writeFileSync(path.join(dir, "snapshots", "fitness-2026-10-02.db"), "a snapshot");
  return dir;
}

describe("preparePersonDir", () => {
  it("lays out a person's folder: db/ and photos/ tagged for restic to skip, snapshots/ not", () => {
    const dir = tempDir();
    const paths = preparePersonDir(dir, KEY);
    const home = path.join(dir, "users", KEY);
    expect(paths).toEqual({
      dir: home,
      dbFile: path.join(home, "db", "fitness.db"),
      photoDir: path.join(home, "photos"),
      snapshotDir: path.join(home, "snapshots"),
    });
    expect(personPaths(dir, KEY)).toEqual(paths);
    for (const tagged of ["db", "photos"]) {
      const tag = fs.readFileSync(path.join(home, tagged, "CACHEDIR.TAG"), "utf8");
      expect(tag.startsWith(SIGNATURE)).toBe(true);
      expect(tag).toBe(CACHEDIR_TAG);
    }
    expect(fs.existsSync(paths.snapshotDir)).toBe(true);
    expect(fs.existsSync(path.join(paths.snapshotDir, "CACHEDIR.TAG"))).toBe(false);
  });

  it("clears a snapshot copy that a crash left beside a person's database", () => {
    const dir = tempDir();
    const db = path.join(dir, "users", KEY, "db");
    fs.mkdirSync(db, { recursive: true });
    fs.writeFileSync(path.join(db, "fitness.db"), "");
    for (const stale of ["fitness.db.snapshot-part", "fitness.db.snapshot-part-journal"]) {
      fs.writeFileSync(path.join(db, stale), "a copy with conversations in it");
    }
    preparePersonDir(dir, KEY);
    expect(fs.readdirSync(db).sort()).toEqual(["CACHEDIR.TAG", "fitness.db"]);
  });
});

describe("moveOwnerIn", () => {
  it("moves milestone 2.1's folders into the owner's, every row and file intact", () => {
    const dir = singlePersonFolder();
    expect(moveOwnerIn(dir, KEY)).toBe("moved");
    for (const name of ["db", "photos", "snapshots"]) expect(fs.existsSync(path.join(dir, name))).toBe(false);
    const owner = personPaths(dir, KEY);
    const moved = new Database(owner.dbFile, { readonly: true });
    expect(moved.prepare("SELECT id FROM entries ORDER BY id").pluck().all()).toEqual(["a", "b"]);
    moved.close();
    expect(fs.readFileSync(path.join(owner.photoDir, `${"1".repeat(32)}.jpg`), "utf8")).toBe("a photo");
    expect(fs.readFileSync(path.join(owner.snapshotDir, "fitness-2026-10-02.db"), "utf8")).toBe("a snapshot");
    expect(fs.readFileSync(path.join(owner.dir, "db", "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.readFileSync(path.join(owner.photoDir, "CACHEDIR.TAG"), "utf8")).toBe(CACHEDIR_TAG);
    expect(fs.existsSync(`${owner.dir}.moving`)).toBe(false);
  });

  it("takes a journal along with its database", () => {
    const dir = singlePersonFolder();
    fs.writeFileSync(path.join(dir, "db", "fitness.db-journal"), "journal");
    moveOwnerIn(dir, KEY);
    expect(fs.readFileSync(`${personPaths(dir, KEY).dbFile}-journal`, "utf8")).toBe("journal");
  });

  it("finds nothing to move on the next start, or in a fresh folder", () => {
    const dir = singlePersonFolder();
    moveOwnerIn(dir, KEY);
    expect(moveOwnerIn(dir, KEY)).toBe("none");
    const fresh = tempDir();
    expect(moveOwnerIn(fresh, KEY)).toBe("none");
    expect(fs.readdirSync(fresh)).toEqual([]);
  });

  it("never overwrites an owner's folder that already exists", () => {
    const dir = singlePersonFolder();
    const owner = personPaths(dir, KEY);
    fs.mkdirSync(path.dirname(owner.dbFile), { recursive: true });
    fs.writeFileSync(owner.dbFile, "the owner's current database");
    expect(moveOwnerIn(dir, KEY)).toBe("both");
    expect(fs.readFileSync(owner.dbFile, "utf8")).toBe("the owner's current database");
    expect(fs.existsSync(path.join(dir, "db", "fitness.db"))).toBe(true);
  });

  it("finishes a move that a crash cut short", () => {
    const dir = singlePersonFolder();
    const staging = `${personPaths(dir, KEY).dir}.moving`;
    fs.mkdirSync(staging, { recursive: true });
    fs.renameSync(path.join(dir, "db"), path.join(staging, "db")); // the crash came after the first rename
    expect(moveOwnerIn(dir, KEY)).toBe("moved");
    const owner = personPaths(dir, KEY);
    expect(fs.existsSync(owner.dbFile)).toBe(true);
    expect(fs.existsSync(path.join(owner.photoDir, `${"1".repeat(32)}.jpg`))).toBe(true);
    expect(fs.existsSync(path.join(owner.snapshotDir, "fitness-2026-10-02.db"))).toBe(true);
    expect(fs.existsSync(staging)).toBe(false);
    for (const name of ["db", "photos", "snapshots"]) expect(fs.existsSync(path.join(dir, name))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test --workspace server -- people datadir`.

Expected: FAIL. `../src/people/people.ts` doesn't exist, and `moveOwnerIn`, `personPaths` and `preparePersonDir` aren't exported.

- [ ] **Step 3: Implement**

Append to `server/src/db/location.ts`:

```ts
/** Where one person's data lives (2.2 §4). `key` is their personKey, never an email. */
export interface PersonPaths {
  dir: string;
  dbFile: string;
  photoDir: string;
  snapshotDir: string;
}

export function personPaths(dataDir: string, key: string): PersonPaths {
  const dir = path.join(dataDir, "users", key);
  return { dir, dbFile: path.join(dir, "db", "fitness.db"), photoDir: path.join(dir, "photos"), snapshotDir: path.join(dir, "snapshots") };
}

/**
 * Lays out one person's folder: db/ and photos/, both tagged so backups skip them, and snapshots/. Run before their
 * database is opened, because it clears the copy a crashed snapshot can leave beside it.
 */
export function preparePersonDir(dataDir: string, key: string): PersonPaths {
  const paths = personPaths(dataDir, key);
  const dbDir = path.dirname(paths.dbFile);
  for (const dir of [dbDir, paths.photoDir, paths.snapshotDir]) fs.mkdirSync(dir, { recursive: true });
  writeTag(dbDir);
  writeTag(paths.photoDir);
  // A crash during a snapshot leaves its copy, conversations still in it, beside the database until the next one.
  const part = snapshotPartFile(paths.dbFile);
  for (const stale of [part, `${part}-journal`]) fs.rmSync(stale, { force: true });
  return paths;
}

/** What the first start of milestone 2.2 found at the top of the data folder. */
export type OwnerMove = "none" | "moved" | "both";

/**
 * Milestone 2.2's one move (2.2 §4): milestone 2.1's db/, photos/ and snapshots/ at the top of the data folder become
 * the owner's. Run before anything opens a database. The folders go into a staging folder and arrive with one rename,
 * so a crash part-way leaves something the next start finishes, never a half-filled owner's folder. An owner's folder
 * that already exists is never touched: "both".
 */
export function moveOwnerIn(dataDir: string, ownerKey: string): OwnerMove {
  const owner = personPaths(dataDir, ownerKey);
  const staging = `${owner.dir}.moving`;
  if (!fs.existsSync(path.join(dataDir, "db", "fitness.db")) && !fs.existsSync(staging)) return "none";
  if (fs.existsSync(owner.dir)) return "both";
  fs.mkdirSync(staging, { recursive: true });
  // db/ moves whole, so a journal stays beside its database.
  for (const name of ["db", "photos", "snapshots"]) {
    const from = path.join(dataDir, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(staging, name));
  }
  fs.renameSync(staging, owner.dir);
  return "moved";
}
```

Create `server/src/people/people.ts`:

```ts
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Identity } from "../auth/access.ts";
import { preparePersonDir } from "../db/location.ts";
import { openDatabase } from "../db/open.ts";
import type { Sql } from "../db/types.ts";
import { failInterrupted } from "../messages/messages.ts";

// One database and one photo folder per person (2.2 §4). Nobody's data is ever reachable from another's.

/** A person's folder name: the sha256 of their verified, lowercased email, in lowercase hex (2.2 §3). */
export function personKey(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

/** How logs name a person: the first 8 characters of their key, never their email (2.2 §8). */
export function shortKey(key: string): string {
  return key.slice(0, 8);
}

const KEY = /^[0-9a-f]{64}$/;

/** One person's open database and folders. */
export interface Store {
  key: string;
  db: Sql;
  sqlite: Database.Database;
  photoDir: string;
  snapshotDir: string;
}

/** The signed-in person a request acts for. */
export interface Person {
  key: string;
  owner: boolean;
  db: Sql;
  photoDir: string;
}

export interface People {
  /** The signed-in person's data, opened on their first request and kept open. */
  personFor(identity: Identity): Person;
  /** A person's store by key, opened if it isn't yet. */
  store(key: string): Store;
  /** Every person's folder under users/, by key, sorted. */
  keys(): string[];
  close(): void;
}

export function createPeople(opts: { dataDir: string }): People {
  const open = new Map<string, { store: Store; close: () => void }>();
  const usersDir = path.join(opts.dataDir, "users");

  function store(key: string): Store {
    // Keys come from personKey or from folder names; anything else must never reach a path.
    if (!KEY.test(key)) throw new Error("not a person key");
    const existing = open.get(key);
    if (existing) return existing.store;
    const paths = preparePersonDir(opts.dataDir, key);
    // The settings and startup snapshot milestone 1 gave the one database (spec §14.4).
    const database = openDatabase({ file: paths.dbFile, snapshotDir: paths.snapshotDir });
    // Nothing in this process has touched this database yet, so a message still pending was cut off by the last restart.
    failInterrupted(database.db);
    const opened: Store = { key, db: database.db, sqlite: database.sqlite, photoDir: paths.photoDir, snapshotDir: paths.snapshotDir };
    open.set(key, { store: opened, close: database.close });
    return opened;
  }

  return {
    personFor(identity) {
      const opened = store(personKey(identity.email));
      return { key: opened.key, owner: identity.owner, db: opened.db, photoDir: opened.photoDir };
    },
    store,
    keys() {
      if (!fs.existsSync(usersDir)) return [];
      return fs
        .readdirSync(usersDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && KEY.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    },
    close() {
      for (const { close } of open.values()) close();
      open.clear();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test --workspace server -- people datadir`. Expected: PASS.

Then run the whole server suite, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/location.ts server/src/people/people.ts server/test/people.test.ts server/test/datadir.test.ts
git commit -m "feat(server): a folder and a database per person, and the owner's one-time move into theirs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Startup and the jobs, for every person

**Files:**
- Modify:
  - `server/src/jobs.ts`
  - `server/src/main.ts`
  - `server/src/db/location.ts`: remove `MoveOutcome`, `DataPaths` and `prepareDataDir`
  - `server/test/helpers.ts`: add `testPeople`
- Test:
  - `server/test/ops.test.ts`: the three `startNightlySnapshot` tests
  - `server/test/retention.test.ts`: the two `startRetention` tests
  - `server/test/datadir.test.ts`: delete the `prepareDataDir` block and its import

**Interfaces:**
- Consumes (Task 2): `createPeople`, `personKey`, `shortKey`, `People`, `Store`, `moveOwnerIn`.
- Produces:

```ts
startNightlySnapshot(opts: { people: People; keep: number; timeZone: string; log: FastifyBaseLogger; now?: () => Date }): Cron
startRetention(opts: { people: People; hours: number; log: FastifyBaseLogger; now?: () => Date }): Cron
// server/test/helpers.ts
testPeople(...emails: string[]): { dataDir: string; people: People; stores: Store[] }
```

After this task the app still serves one database: the owner's store, passed to `buildApp` as before. Task 4 hands requests their own person.

- [ ] **Step 1: Write the failing tests**

In `server/test/helpers.ts`:
- Add the imports `import { createPeople, personKey } from "../src/people/people.ts";` and `import type { People, Store } from "../src/people/people.ts";`.
- Add:

```ts
/** A registry over a fresh data folder, with these people's databases already open. Call `people.close()` when done. */
export function testPeople(...emails: string[]): { dataDir: string; people: People; stores: Store[] } {
  const dataDir = tempDir();
  const people = createPeople({ dataDir });
  return { dataDir, people, stores: emails.map((email) => people.store(personKey(email))) };
}
```

In `server/test/ops.test.ts`, replace the three tests in `describe("startNightlySnapshot", …)`:
- Add the imports `saveProfile` (from `../src/profile/profile.ts`), `shortKey` (from `../src/people/people.ts`), and `NOW`, `makeProfile` and `testPeople` (from `./helpers.ts`).
- Keep `openTestDb` and `tempDir` while the `runNightlySnapshot` tests still use them.

```ts
describe("startNightlySnapshot", () => {
  it("is set for 03:00 in the owner's timezone, whatever the pod's", () => {
    const { people } = testPeople();
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log: recorder().log });
    const tokyo = startNightlySnapshot({ people, keep: 7, timeZone: "Asia/Tokyo", log: recorder().log });
    try {
      // 13:00 BST on 3 October: the next 03:00 in London is 03:00 BST, which is 02:00 UTC.
      expect(job.nextRun(new Date("2026-10-03T12:00:00Z"))?.toISOString()).toBe("2026-10-04T02:00:00.000Z");
      // After the clocks go back on 25 October, 03:00 in London is 03:00 UTC.
      expect(job.nextRun(new Date("2026-10-25T12:00:00Z"))?.toISOString()).toBe("2026-10-26T03:00:00.000Z");
      // No host zone can also give Tokyo (UTC+9, no daylight saving): 18:00 UTC the evening before.
      expect(tokyo.nextRun(new Date("2026-10-03T12:00:00Z"))?.toISOString()).toBe("2026-10-03T18:00:00.000Z");
    } finally {
      job.stop();
      tokyo.stop();
      people.close();
    }
  });

  it("writes everyone's snapshot when it fires, each named after its person's own date, and logs no email", async () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    saveProfile(stores[1].db, makeProfile({ timezone: "Pacific/Kiritimati" }), NOW.toISOString());
    const { log, calls } = recorder();
    // 12:00 UTC on 3 October is the 3rd in London (the default with no profile) and already the 4th on Kiritimati (UTC+14).
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    try {
      await job.trigger();
      expect(fs.readdirSync(stores[0].snapshotDir)).toEqual(["fitness-2026-10-03.db"]);
      expect(fs.readdirSync(stores[1].snapshotDir)).toEqual(["fitness-2026-10-04.db"]);
      expect(calls.map((c) => c.level)).toEqual(["info", "info"]);
      expect(calls.map((c) => c.fields.person).sort()).toEqual(stores.map((s) => shortKey(s.key)).sort());
      expect(calls.map((c) => c.fields.file).sort()).toEqual(["fitness-2026-10-03.db", "fitness-2026-10-04.db"]);
      const text = JSON.stringify(calls);
      expect(text).not.toContain("@");
      for (const store of stores) expect(text).not.toContain(store.key);
    } finally {
      job.stop();
      people.close();
    }
  });

  it("logs one person's failed snapshot and still writes everyone else's", async () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    const { log, calls } = recorder();
    const job = startNightlySnapshot({ people, keep: 7, timeZone: "Europe/London", log, now: () => NOW });
    stores[0].sqlite.close(); // this person's snapshot now fails: the connection is closed
    try {
      await expect(job.trigger()).resolves.toBeUndefined();
      const errors = calls.filter((c) => c.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ msg: "nightly snapshot failed", fields: { person: shortKey(stores[0].key) } });
      expect(errors[0].fields.err).toBeInstanceOf(Error);
      expect(fs.readdirSync(stores[1].snapshotDir)).toHaveLength(1);
    } finally {
      job.stop();
      people.close();
    }
  });
});
```

In `server/test/retention.test.ts`, replace the two tests in `describe("startRetention", …)`. Add the imports `shortKey` (from `../src/people/people.ts`) and `testPeople` (from `./helpers.ts`).

```ts
describe("startRetention", () => {
  it("purges everyone once straight away, then every hour, logging counts by person", () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    for (const store of stores) message(store.db, "old", "2026-10-01", hoursAgo(50));
    const logged: unknown[] = [];
    const log = { info: (obj: unknown) => logged.push(obj), error: () => {} } as unknown as FastifyBaseLogger;
    const job = startRetention({ people, hours: 48, log, now: () => NOW });
    for (const store of stores) expect(store.db.select().from(messages).all()).toEqual([]);
    const keys = stores.map((s) => s.key).sort();
    expect(logged).toEqual(keys.map((key) => ({ person: shortKey(key), messages: 1, photos: 0, threads: 0, orphanFiles: 0 })));
    expect(job.getPattern()).toBe("7 * * * *");
    job.stop();
    people.close();
  });

  it("logs one person's failed purge, goes on to the next, and the job can still be stopped", () => {
    const { people, stores } = testPeople("owner@example.com", "friend@example.com");
    for (const store of stores) message(store.db, "old", "2026-10-01", hoursAgo(50));
    const infos: unknown[][] = [];
    const errors: unknown[][] = [];
    const log = {
      info: (...args: unknown[]) => infos.push(args),
      error: (...args: unknown[]) => errors.push(args),
    } as unknown as FastifyBaseLogger;
    // The sweep cannot list a photo folder that is not there.
    fs.rmSync(stores[0].photoDir, { recursive: true, force: true });
    const job = startRetention({ people, hours: 48, log, now: () => NOW });
    expect(errors).toEqual([[{ err: expect.objectContaining({ code: "ENOENT" }), person: shortKey(stores[0].key) }, "retention purge failed"]]);
    expect(stores[1].db.select().from(messages).all()).toEqual([]);
    expect(infos).toEqual([[{ person: shortKey(stores[1].key), messages: 1, photos: 0, threads: 0, orphanFiles: 0 }, "expired conversations deleted"]]);
    expect(job.isStopped()).toBe(false);
    job.stop();
    expect(job.isStopped()).toBe(true);
    people.close();
  });
});
```

In `server/test/datadir.test.ts`:
- Delete the whole `describe("prepareDataDir", …)` block.
- Drop `prepareDataDir` from the import.

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test --workspace server -- ops retention datadir`.

Expected: FAIL. `startNightlySnapshot` and `startRetention` still want `sqlite`/`dir` and `sql`/`photoDir`.

- [ ] **Step 3: Implement**

`server/src/jobs.ts` becomes:

```ts
import type Database from "better-sqlite3";
import { Cron } from "croner";
import type { FastifyBaseLogger } from "fastify";
import path from "node:path";
import { pruneSnapshots, snapshot } from "./db/snapshot.ts";
import { shortKey } from "./people/people.ts";
import type { People, Store } from "./people/people.ts";
import { getProfile } from "./profile/profile.ts";
import { purgeExpired } from "./retention/retention.ts";
import { localDate } from "./time.ts";

export function runNightlySnapshot(sqlite: Database.Database, dir: string, keep: number, timeZone: string, now: Date): string {
  const file = snapshot(sqlite, dir, `fitness-${localDate(now, timeZone)}.db`);
  pruneSnapshots(dir, "fitness-", keep);
  return file;
}

/** A job's work for every person's folder, one after another: one person's failure is logged and the rest go on (2.2 §5). */
function forEachPerson(people: People, log: FastifyBaseLogger, failure: string, work: (store: Store) => void): void {
  for (const key of people.keys()) {
    try {
      work(people.store(key));
    } catch (err) {
      // Named by the start of the key, never by an email (2.2 §8).
      log.error({ err, person: shortKey(key) }, failure);
    }
  }
}

/**
 * 03:00 in the owner's timezone, half an hour before the cluster's restic run copies /data (spec §14.4). Each
 * person's snapshot is named after their own local date.
 */
export function startNightlySnapshot(opts: {
  people: People;
  keep: number;
  timeZone: string;
  log: FastifyBaseLogger;
  now?: () => Date;
}): Cron {
  const now = opts.now ?? (() => new Date());
  return new Cron("0 3 * * *", { timezone: opts.timeZone }, () => {
    forEachPerson(opts.people, opts.log, "nightly snapshot failed", (store) => {
      const timeZone = getProfile(store.db)?.timezone ?? opts.timeZone;
      const file = runNightlySnapshot(store.sqlite, store.snapshotDir, opts.keep, timeZone, now());
      // The file's name only: its path holds the whole key.
      opts.log.info({ person: shortKey(store.key), file: path.basename(file) }, "nightly snapshot written");
    });
  });
}

/** Deletes everyone's expired conversations and photos at startup and then hourly, at minute 7 (spec §6.6). */
export function startRetention(opts: {
  people: People;
  hours: number;
  log: FastifyBaseLogger;
  now?: () => Date;
}): Cron {
  const now = opts.now ?? (() => new Date());
  const run = () =>
    forEachPerson(opts.people, opts.log, "retention purge failed", (store) => {
      const counts = purgeExpired(store.db, store.photoDir, now(), opts.hours);
      // Counts only: never what was deleted.
      if (Object.values(counts).some((n) => n > 0)) opts.log.info({ person: shortKey(store.key), ...counts }, "expired conversations deleted");
    });
  run();
  return new Cron("7 * * * *", run);
}
```

`server/src/main.ts`:

1. Replace the imports of `prepareDataDir`, `openDatabase` and `failInterrupted` with:

   ```ts
   import { moveOwnerIn } from "./db/location.ts";
   import { createPeople, personKey } from "./people/people.ts";
   ```

2. Replace everything from `const paths = prepareDataDir(config.dataDir);` through `failInterrupted(database.db);` with:

   ```ts
   const ownerKey = personKey(config.ownerEmail);
   // Before anything opens a database: milestone 2.1's one folder becomes the owner's (2.2 §4).
   const move = moveOwnerIn(config.dataDir, ownerKey);
   const people = createPeople({ dataDir: config.dataDir });
   // Everyone's database opens now, as the one database did before: a lock left by the previous pod is waited out here,
   // at startup, never inside a request. A database with a migration to run is snapshotted first.
   for (const key of people.keys()) people.store(key);
   const owner = people.store(ownerKey);
   ```

3. In `buildApp({…})`, `db: database.db` becomes `db: owner.db` and `photoDir: paths.photoDir` becomes `photoDir: owner.photoDir`.

4. Replace the two `paths.move` log lines with:

   ```ts
   if (move === "moved") app.log.info("moved the owner's data into users/ (milestone 2.2)");
   if (move === "both") app.log.warn("found data in both data/db and the owner's folder under data/users; using the owner's folder. Check the old data/db, data/photos and data/snapshots aren't needed, then remove them");
   ```

5. The two jobs become:

   ```ts
   const job = startNightlySnapshot({ people, keep: config.snapshotKeep, timeZone: getProfile(owner.db)?.timezone ?? "Europe/London", log: app.log });
   const retention = startRetention({ people, hours: config.retentionHours, log: app.log });
   ```

6. In `shutdown`, `database.close();` becomes `people.close();`.

`server/src/db/location.ts`:
- Delete `MoveOutcome`, `DataPaths` and `prepareDataDir`.
- Keep `CACHEDIR_TAG`, `writeTag` and Task 2's functions.
- Then run `grep -rn "prepareDataDir\|MoveOutcome\|DataPaths" server/ web/ shared/`. Expected: no matches.

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test --workspace server -- ops retention datadir`. Expected: PASS.

Then run the whole server suite, `npm run typecheck` and `npm run lint`. Expected: all green.

Finally, boot check:
1. Run `NODE_ENV=development DEV_AUTH_EMAIL=dev@localhost DATA_DIR=$(mktemp -d) PORT=8099 METRICS_PORT=9499 node server/src/main.ts`.
2. Run `curl -s localhost:8099/api/health`. Expected: `{"ok":true}`.
3. Check that `$DATA_DIR/users/<sha256 of dev@localhost>/db/fitness.db` exists.
4. Stop the server with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add server/src/jobs.ts server/src/main.ts server/src/db/location.ts server/test/helpers.ts server/test/ops.test.ts server/test/retention.test.ts server/test/datadir.test.ts
git commit -m "feat(server): startup moves the owner in and opens everyone; the nightly snapshot and retention run per person

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every request reads and writes its own person's data

**Files:**
- Modify:
  - `server/src/deps.ts`, `server/src/app.ts`, `server/src/main.ts`
  - every file in `server/src/routes/` that takes `AppDeps`: `days.ts`, `entries.ts`, `messages.ts`, `photos.ts`, `profile.ts`
  - `server/test/helpers.ts`, `server/test/app.test.ts`, `server/test/logging.test.ts`, `server/test/photos.test.ts`
- Create: `server/test/separation.test.ts`

**Interfaces:**
- Consumes (Tasks 1–3): `Identity.owner`; `People.personFor`, `Person`, `personKey`, `testPeople`.
- Produces:

```ts
// server/src/deps.ts
export interface AppDeps { people: People; verifier; now; webDist; ai; coachBudgetMs; logger?; logStream?; metrics?; streamKeepAliveMs? } // no db, no photoDir
export interface RequestDeps extends Omit<AppDeps, "people"> { person: Person; db: Sql; photoDir: string }
export function forRequest(deps: AppDeps, req: FastifyRequest): RequestDeps
// fastify
FastifyRequest.person: Person | null
// server/test/helpers.ts — testApp(opts) gains `guests?: string[]` and returns, besides today's fields:
dataDir: string; people: People; headersFor(email: string): Promise<{ "cf-access-jwt-assertion": string }>; storeOf(email: string): Store
```

- [ ] **Step 1: Write the failing tests**

Create `server/test/separation.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { entries, photos } from "../src/db/schema.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import { fakeJpeg } from "./images.ts";
import { logItemsInput, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};
const BANANA = { name: "Banana", kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 };
const FRIEND = "friend@example.com";
type Headers = Record<string, string>;

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** The owner and one guest, each with their own profile. The coach logs eggs for each of the first two messages. */
async function twoPeople(): Promise<{ app: TestApp; owner: Headers; guest: Headers }> {
  const eggs = () => [toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")];
  const app = await testApp({ guests: [FRIEND], ai: fakeAi([...eggs(), ...eggs()]) });
  t = app;
  const owner = app.headers;
  const guest = await app.headersFor(FRIEND);
  expect((await app.app.inject({ method: "PUT", url: "/api/profile", headers: owner, payload: PROFILE })).statusCode).toBe(200);
  expect((await app.app.inject({ method: "PUT", url: "/api/profile", headers: guest, payload: { ...PROFILE, weight_kg: 60 } })).statusCode).toBe(200);
  return { app, owner, guest };
}

const get = (app: TestApp, url: string, headers: Headers) => app.app.inject({ method: "GET", url, headers });
const addBanana = (app: TestApp, headers: Headers, id = randomUUID()) =>
  app.app.inject({ method: "POST", url: "/api/entries", headers, payload: { id, date: "2026-10-03", foods: [BANANA] } });
const send = (app: TestApp, headers: Headers, body: { text: string; photo_ids?: string[] }) =>
  app.app.inject({ method: "POST", url: "/api/messages", headers, payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", ...body } });

describe("friends and family (2.2)", () => {
  it("lets a listed guest in, whatever the case of their email, and answers anyone else as if unsigned", async () => {
    const app = await testApp({ guests: [FRIEND] });
    t = app;
    expect((await get(app, "/api/profile", await app.headersFor("Friend@Example.com"))).statusCode).toBe(404); // in, with no profile yet
    const stranger = await get(app, "/api/profile", await app.headersFor("stranger@example.com"));
    const unsigned = await app.app.inject({ method: "GET", url: "/api/profile" });
    expect([stranger.statusCode, stranger.body]).toEqual([401, ""]);
    expect([unsigned.statusCode, unsigned.body]).toEqual([401, ""]);
  });

  it("gives each person their own profile", async () => {
    const { app, owner, guest } = await twoPeople();
    expect((await get(app, "/api/profile", owner)).json().profile.weight_kg).toBe(80);
    expect((await get(app, "/api/profile", guest)).json().profile.weight_kg).toBe(60);
  });

  it("never shows one person's days, entries or calendar to the other", async () => {
    const { app, owner, guest } = await twoPeople();
    const id = randomUUID();
    expect((await addBanana(app, owner, id)).statusCode).toBe(201);
    expect((await get(app, "/api/days/2026-10-03", guest)).json().entries).toEqual([]);
    expect((await get(app, "/api/days?from=2026-10-01&to=2026-10-03", guest)).json().days).toEqual([]);
    expect((await get(app, "/api/days?from=2026-10-01&to=2026-10-03", owner)).json().days).toHaveLength(1);
    // Someone else's entry id is simply not there.
    const patch = await app.app.inject({ method: "PATCH", url: `/api/entries/${id}`, headers: guest, payload: { foods: [BANANA], exercises: [] } });
    expect(patch.statusCode).toBe(404);
    expect((await app.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: guest })).statusCode).toBe(404);
    expect((await get(app, "/api/days/2026-10-03", owner)).json().entries.map((e: { id: string }) => e.id)).toEqual([id]);
  });

  it("keeps each person's conversation with the coach, and what it logged, to that person", async () => {
    const { app, owner, guest } = await twoPeople();
    expect((await send(app, owner, { text: "two scrambled eggs" })).statusCode).toBe(201);
    expect((await send(app, guest, { text: "eggs for me too" })).statusCode).toBe(201);
    const ownersDay = (await get(app, "/api/days/2026-10-03", owner)).json();
    const guestsDay = (await get(app, "/api/days/2026-10-03", guest)).json();
    expect(ownersDay.messages.map((m: { text: string }) => m.text)).toEqual(["two scrambled eggs", "Logged."]);
    expect(guestsDay.messages.map((m: { text: string }) => m.text)).toEqual(["eggs for me too", "Logged."]);
    expect(ownersDay.entries).toHaveLength(1);
    expect(guestsDay.entries).toHaveLength(1);
    // Retrying someone else's message by its id finds nothing.
    const retry = await app.app.inject({ method: "POST", url: `/api/messages/${ownersDay.messages[0].id}/retry`, headers: guest });
    expect(retry.statusCode).toBe(404);
  });

  it("serves a photo only to the person who uploaded it", async () => {
    const { app, owner, guest } = await twoPeople();
    const upload = await app.app.inject({ method: "POST", url: "/api/photos", headers: { ...owner, "content-type": "image/jpeg" }, payload: fakeJpeg(8, 6) });
    expect(upload.statusCode).toBe(201);
    const { id } = upload.json();
    expect((await get(app, `/api/photos/${id}`, owner)).statusCode).toBe(200);
    expect((await get(app, `/api/photos/${id}`, guest)).statusCode).toBe(404);
    // Nor can the guest attach it to a message of their own.
    const claim = await send(app, guest, { text: "", photo_ids: [id] });
    expect(claim.statusCode).toBe(400);
    expect(claim.json()).toEqual({ error: "photo_not_found" });
  });

  it("keeps each person's rows in their own database and photos in their own folder", async () => {
    const { app, owner, guest } = await twoPeople();
    const id = randomUUID();
    await addBanana(app, owner, id);
    await app.app.inject({ method: "POST", url: "/api/photos", headers: { ...guest, "content-type": "image/jpeg" }, payload: fakeJpeg(8, 6) });
    const theirs = app.storeOf(FRIEND);
    expect(app.db.select({ id: entries.id }).from(entries).all()).toEqual([{ id }]);
    expect(theirs.db.select().from(entries).all()).toEqual([]);
    expect(app.db.select().from(photos).all()).toEqual([]);
    expect(theirs.db.select().from(photos).all()).toHaveLength(1);
    expect(theirs.photoDir).not.toBe(app.photoDir);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test --workspace server -- separation`.

Expected: FAIL. `testApp` takes no `guests` and returns no `headersFor` or `storeOf`, and a guest's requests would reach the owner's database.

- [ ] **Step 3: Implement**

`server/src/deps.ts` becomes:

```ts
import type { FastifyRequest } from "fastify";
import type { AiClient } from "./ai/client.ts";
import type { Verifier } from "./auth/access.ts";
import type { Sql } from "./db/types.ts";
import type { Metrics } from "./metrics.ts";
import type { People, Person } from "./people/people.ts";

/** Everything the HTTP layer needs, injected so tests can replace any of it. */
export interface AppDeps {
  /** Everyone's data: a database and a photo folder per person (2.2 §4). */
  people: People;
  verifier: Verifier;
  now: () => Date;
  /** The built PWA (web/dist); null in development and in tests. */
  webDist: string | null;
  /** Null when ANTHROPIC_API_KEY is unset: the coach is off, manual logging still works. */
  ai: AiClient | null;
  /** Total time one coach message may take; under Cloudflare's 100 s proxy timeout. */
  coachBudgetMs: number;
  logger?: boolean;
  /** Tests only: where log lines go when logger is on. */
  logStream?: { write(line: string): void };
  metrics?: Metrics;
  /** How often a live-steps stream says it is still there (spec §6.3); 15 s unless a test changes it. */
  streamKeepAliveMs?: number;
}

/** What a route works with: the app's dependencies, with the signed-in person's database and photos. */
export interface RequestDeps extends Omit<AppDeps, "people"> {
  person: Person;
  db: Sql;
  /** Where this person's photos live: <DATA_DIR>/users/<key>/photos (spec §6.5). */
  photoDir: string;
}

/** The app's dependencies for this request's person. Every /api route runs after the sign-in hook has set one. */
export function forRequest(deps: AppDeps, req: FastifyRequest): RequestDeps {
  const person = req.person;
  if (!person) throw new Error("this request has no signed-in person");
  return { ...deps, person, db: person.db, photoDir: person.photoDir };
}
```

`server/src/app.ts`:

1. Add `import type { Person } from "./people/people.ts";`.

2. The module augmentation becomes:

   ```ts
   declare module "fastify" {
     interface FastifyRequest {
       identity: Identity | null;
       /** The signed-in person's data, set with the identity (2.2 §4). */
       person: Person | null;
     }
   }
   ```

3. After `app.decorateRequest("identity", null);`, add `app.decorateRequest("person", null);`.

4. In the `onRequest` hook:
   - Verify into a local, so the person is opened from a value TypeScript knows is set.
   - Keep the `catch` block as it is.

   The verifying part becomes:

   ```ts
       let identity: Identity;
       try {
         identity = await deps.verifier.verify(token);
       } catch (err) {
         // … unchanged: the warning for a refused token, then `return reply.code(401).send();`
       }
       req.identity = identity;
       // Opens the person's database on their first request. Everything a route reads or writes is theirs alone.
       req.person = deps.people.personFor(identity);
   ```

5. The comment above the hook, "needs the owner's Access token", becomes "needs a signed-in person's Access token".

**The routes.** In each of `days.ts`, `entries.ts`, `messages.ts`, `photos.ts` and `profile.ts`:

1. The `register…Routes(app, deps: AppDeps)` parameter is renamed `appDeps`.
2. Every route handler's first line becomes `const deps = forRequest(appDeps, req);`. Rename a handler's `_req` parameter to `req` where needed.
3. Every helper function that takes the dependencies changes its parameter type from `AppDeps` to `RequestDeps`. As of 2.1 these are `runSafely`, `messageResult`, `dayOf` and `streamWork` in `messages.ts`, and `entryResult` in `entries.ts`.
4. Imports become `import { forRequest } from "../deps.ts";` plus `import type { AppDeps, RequestDeps } from "../deps.ts";`, keeping only the names each file uses.
5. Nothing else in the route bodies changes: `deps.db`, `deps.photoDir` and `deps.now` keep working.

For example, `profile.ts` becomes:

```ts
export function registerProfileRoutes(app: FastifyInstance, appDeps: AppDeps): void {
  app.get("/api/profile", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(404).send({ error: "no_profile" });
    return profileView(profile, deps.now());
  });

  app.put("/api/profile", async (req, reply) => {
    const deps = forRequest(appDeps, req);
    const profile = parseBody(ProfileInput, req.body, reply);
    // … unchanged …
  });
}
```

In `photos.ts`, the two handlers sit inside the `app.register(async (photos) => { … })` context. They get the same first line. The context's comment, "the owner's sign-in", becomes "the sign-in".

`server/src/main.ts`: in `buildApp({…})`, replace `db: owner.db` and `photoDir: owner.photoDir` with `people`. Keep `const owner = people.store(ownerKey);`: the nightly job still reads the owner's timezone from it.

`server/test/helpers.ts`: `testApp` becomes the following. `import type { Store }` is already there from Task 3; `personKey` is imported.

```ts
export async function testApp(opts: { now?: Date; webDist?: string | null; ai?: AiClient | null; coachBudgetMs?: number; metrics?: Metrics; streamKeepAliveMs?: number; logLines?: string[]; guests?: string[] } = {}) {
  const auth = await makeAccess("owner@example.com", opts.guests ?? []);
  const { dataDir, people, stores } = testPeople(auth.access.ownerEmail);
  const owner = stores[0];
  const app = buildApp({
    people,
    verifier: auth.verifier,
    now: () => opts.now ?? NOW,
    webDist: opts.webDist ?? null,
    ai: opts.ai ?? null,
    coachBudgetMs: opts.coachBudgetMs ?? 90_000,
    metrics: opts.metrics,
    streamKeepAliveMs: opts.streamKeepAliveMs,
    logger: opts.logLines !== undefined,
    logStream: opts.logLines ? { write: (line: string) => void opts.logLines?.push(line) } : undefined,
  });
  await app.ready();
  const ownerToken = await auth.token();
  return {
    app,
    /** The owner's database and photo folder: what every one-person test reads and seeds. */
    db: owner.db,
    photoDir: owner.photoDir,
    dataDir,
    people,
    auth,
    headers: { "cf-access-jwt-assertion": ownerToken },
    /** Headers signed in as `email`, whether or not they're on the list. */
    headersFor: async (email: string) => ({ "cf-access-jwt-assertion": await auth.token({ email }) }),
    /** That person's database and photo folder, opened if need be. */
    storeOf: (email: string): Store => people.store(personKey(email.trim().toLowerCase())),
    close: async () => {
      await app.close();
      people.close();
    },
  };
}
```

`openTestDb` stays: unit tests use it.

**The direct `buildApp` calls.** There are three: `app.test.ts`'s `appWithSecret`, and `logging.test.ts`'s `loggingApp` and "buildApp logging" test. In each:
1. Replace `const database = openTestDb();` with `const { people } = testPeople();`.
2. Replace the `db: database.db,` and `photoDir: tempDir(),` properties with `people,`.
3. Replace `database.close()` with `people.close()`.
4. Fix the imports: add `testPeople`, and drop `openTestDb` and `tempDir` where they are no longer used.

**`server/test/photos.test.ts`.** In `expectNothingStored`, a person's photo folder now starts with its backup tag. The line becomes:

```ts
  expect(fs.readdirSync(app.photoDir).filter((f) => f !== "CACHEDIR.TAG")).toEqual([]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test --workspace server -- separation`. Expected: PASS.

Then run the whole server suite, `npm run typecheck` and `npm run lint`. Expected: all green.

Then run the checks:
- `grep -rn "AppDeps" server/src/routes/`. Every match should be a `register…Routes(app, appDeps: AppDeps)` signature or an import.
- `grep -rn "forRequest(appDeps, req)" server/src/routes/ | wc -l`. The result should equal the number of route handlers: as of 2.1, 2 in `days.ts`, 3 in `entries.ts`, 2 in `messages.ts`, 2 in `photos.ts` and 2 in `profile.ts`, so 11.
- `grep -rn "appDeps\.db\|appDeps\.photoDir" server/src/`. Expected: no matches; the compiler would refuse them anyway.

- [ ] **Step 5: Commit**

```bash
git add server/src/deps.ts server/src/app.ts server/src/main.ts server/src/routes/days.ts server/src/routes/entries.ts server/src/routes/messages.ts server/src/routes/photos.ts server/src/routes/profile.ts server/test/helpers.ts server/test/app.test.ts server/test/logging.test.ts server/test/photos.test.ts server/test/separation.test.ts
git commit -m "feat(server): every request reads and writes only the signed-in person's database and photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The coach's daily cap, per person

**Files:**
- Modify:
  - `server/src/db/schema.ts`, `server/src/coach/loop.ts`, `server/src/coach/process.ts`
  - `server/src/config.ts`, `server/src/deps.ts`, `server/src/routes/messages.ts`, `server/src/main.ts`
  - `server/test/helpers.ts`, `server/test/app.test.ts`, `server/test/logging.test.ts`
  - `web/src/format.ts`
- Create (the migration files are generated):
  - `server/drizzle/0003_ai_usage.sql`, `server/drizzle/meta/0003_snapshot.json`; the generator also updates `server/drizzle/meta/_journal.json`
  - `server/src/coach/usage.ts`, `server/test/cap.test.ts`
- Test:
  - `server/test/db.test.ts`, `server/test/datadir.test.ts`, `server/test/coach-loop.test.ts`, `server/test/messages.test.ts`, `server/test/config.test.ts`
  - `web/src/format.test.ts`

**Interfaces:**
- Consumes (Task 4): `RequestDeps.person.owner`, `testApp({ guests })`, `storeOf`, `headersFor`.
- Produces:

```ts
// server/src/db/schema.ts
export const aiUsage // table "ai_usage"
// server/src/coach/usage.ts
export interface CoachRun { messageId: string; date: string; model: string | null; calls: number; usage: AiUsage; nowIso: string }
export function recordRun(sql: Sql, run: CoachRun): void
export function callsOn(sql: Sql, date: string): number
// server/src/coach/loop.ts — both LoopResult variants gain `model: string | null`
// server/src/coach/process.ts
CoachDeps.dailyCallCap: number; ProcessOutcomeCode gains "ai_cap"
// server/src/config.ts
Config.aiDailyCallCap: number; Config.guestDailyCallCap: number
// server/src/deps.ts
AppDeps.callCaps: { owner: number; guest: number }
// server/test/helpers.ts
export const TEST_CAPS = { owner: 200, guest: 60 }; testApp(opts) gains `callCaps?`
```

- [ ] **Step 1: Write the failing tests**

Create `server/test/cap.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { callsOn, recordRun } from "../src/coach/usage.ts";
import { aiUsage } from "../src/db/schema.ts";
import type { Sql } from "../src/db/types.ts";
import { purgeExpired } from "../src/retention/retention.ts";
import { fakeAi, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { NOW, logItemsInput, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};
const FRIEND = "friend@example.com";
const NO_TOKENS = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
type Headers = Record<string, string>;

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Model calls already made on `date`, as earlier runs would have recorded them. */
function used(sql: Sql, date: string, calls: number) {
  recordRun(sql, { messageId: randomUUID(), date, model: "claude-opus-5-5", calls, usage: NO_TOKENS, nowIso: NOW.toISOString() });
}

/** The owner and a guest, both set up, with the coach answering from `steps` in order. */
async function appWith(steps: FakeStep[], timezone?: string) {
  const ai = fakeAi(steps);
  const app = await testApp({ guests: [FRIEND], ai });
  t = app;
  const guest = await app.headersFor(FRIEND);
  for (const headers of [app.headers, guest]) {
    const res = await app.app.inject({ method: "PUT", url: "/api/profile", headers, payload: { ...PROFILE, ...(timezone ? { timezone } : {}) } });
    expect(res.statusCode).toBe(200);
  }
  return { app, ai, guest };
}

const send = (app: TestApp, headers: Headers, text = "two eggs") =>
  app.app.inject({ method: "POST", url: "/api/messages", headers, payload: { id: randomUUID(), sent_at: "2026-10-03T11:58:00.000Z", text } });
const retry = (app: TestApp, headers: Headers, id: string) => app.app.inject({ method: "POST", url: `/api/messages/${id}/retry`, headers });

describe("the coach's daily cap (2.2 §6)", () => {
  it("refuses a guest at 60 calls, and Retry too, without calling Claude", async () => {
    const { app, ai, guest } = await appWith([]);
    used(app.storeOf(FRIEND).db, "2026-10-03", 60);
    const res = await send(app, guest);
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect((await retry(app, guest, res.json().user.id)).json().user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect(ai.requests).toHaveLength(0);
  });

  it("lets a guest through at 59, and that run may finish over the cap", async () => {
    const { app, guest } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]);
    used(app.storeOf(FRIEND).db, "2026-10-03", 59);
    expect((await send(app, guest)).json().user.status).toBe("done");
    expect(callsOn(app.storeOf(FRIEND).db, "2026-10-03")).toBe(61);
  });

  it("holds the owner to 200, and never counts one person's calls against another's", async () => {
    const { app, ai, guest } = await appWith([textReply("Noted."), textReply("Noted.")]);
    used(app.db, "2026-10-03", 199);
    expect((await send(app, app.headers)).json().user.status).toBe("done"); // the owner's 200th call
    expect((await send(app, app.headers)).json().user).toMatchObject({ status: "failed", error_code: "ai_cap" });
    expect((await send(app, guest)).json().user.status).toBe("done"); // the guest has made none
    expect(ai.requests).toHaveLength(2);
  });

  it("counts a run that failed, and records each run's model, calls and tokens", async () => {
    const { app, guest } = await appWith([
      new AiError("api_error", "overloaded"),
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
    ]);
    const failed = await send(app, guest);
    expect(failed.json().user).toMatchObject({ status: "failed", error_code: "ai_error" });
    expect((await retry(app, guest, failed.json().user.id)).json().user.status).toBe("done");
    const rows = app.storeOf(FRIEND).db.select().from(aiUsage).all();
    expect(rows.map((r) => ({ date: r.date, model: r.model, calls: r.calls, input_tokens: r.input_tokens, output_tokens: r.output_tokens }))).toEqual([
      { date: "2026-10-03", model: null, calls: 1, input_tokens: 0, output_tokens: 0 },
      { date: "2026-10-03", model: "claude-opus-5-5", calls: 2, input_tokens: 200, output_tokens: 40 },
    ]);
    expect(rows.every((r) => r.message_id === failed.json().user.id)).toBe(true);
    expect(callsOn(app.storeOf(FRIEND).db, "2026-10-03")).toBe(3);
  });

  it("starts afresh at the person's own local midnight", async () => {
    // 12:00 UTC on 3 October is already 01:00 on the 4th in Auckland.
    const { app, guest } = await appWith([textReply("Noted.")], "Pacific/Auckland");
    used(app.storeOf(FRIEND).db, "2026-10-03", 60);
    expect((await send(app, guest)).json().user.status).toBe("done");
    expect(callsOn(app.storeOf(FRIEND).db, "2026-10-04")).toBe(1);
  });

  it("keeps the count when its message expires", async () => {
    const { app, guest } = await appWith([textReply("Noted.")]);
    await send(app, guest);
    const store = app.storeOf(FRIEND);
    purgeExpired(store.db, store.photoDir, new Date("2026-10-06T12:00:00.000Z"), 48);
    expect((await app.app.inject({ method: "GET", url: "/api/days/2026-10-03", headers: guest })).json().messages).toEqual([]);
    expect(store.db.select().from(aiUsage).all()).toHaveLength(1);
  });
});
```

In `server/test/db.test.ts`:
- Add the imports `import { moveOwnerIn } from "../src/db/location.ts";` and `import { createPeople, personKey } from "../src/people/people.ts";`.
- Add inside `describe("openDatabase", …)`:

```ts
  it("upgrades a milestone 2.1 database with an empty ai_usage table, after a snapshot (milestone 2.2)", () => {
    const dir = tempDir();
    const file = path.join(dir, "fitness.db");
    const snapshots = path.join(dir, "snapshots");
    const m21 = openDatabase({ file, snapshotDir: null, migrationsFolder: migrationsUpTo(3) });
    insertEntry(m21.db, sampleEntry({ id: "kept" }), NOW.toISOString());
    m21.close();
    const upgraded = openDatabase({ file, snapshotDir: snapshots });
    expect(upgraded.sqlite.prepare("select count(*) from ai_usage").pluck().get()).toBe(0);
    expect(upgraded.sqlite.prepare("select id from entries").pluck().all()).toEqual(["kept"]);
    upgraded.close();
    const taken = fs.readdirSync(snapshots).filter((f) => f.startsWith("startup-"));
    expect(taken).toHaveLength(1);
    const copy = new Database(path.join(snapshots, taken[0]), { readonly: true });
    expect(copy.prepare("select id from entries").pluck().all()).toEqual(["kept"]);
    expect(copy.prepare("select count(*) from __drizzle_migrations").pluck().get()).toBe(3); // taken before 0003 ran
    copy.close();
  });

  it("snapshots the owner's moved database into their own folder before 0003 runs (milestone 2.2)", () => {
    const dataDir = tempDir();
    fs.mkdirSync(path.join(dataDir, "db"));
    const m21 = openDatabase({ file: path.join(dataDir, "db", "fitness.db"), snapshotDir: null, migrationsFolder: migrationsUpTo(3) });
    insertEntry(m21.db, sampleEntry({ id: "kept" }), NOW.toISOString());
    m21.close();
    const key = personKey("owner@example.com");
    expect(moveOwnerIn(dataDir, key)).toBe("moved");
    const people = createPeople({ dataDir });
    expect(people.store(key).sqlite.prepare("select id from entries").pluck().all()).toEqual(["kept"]);
    people.close();
    const taken = fs.readdirSync(path.join(dataDir, "users", key, "snapshots")).filter((f) => f.startsWith("startup-"));
    expect(taken).toHaveLength(1);
  });
```

In `server/test/datadir.test.ts`, in "have a decision for every table", `KEPT` gains `"ai_usage"`.

In `server/test/coach-loop.test.ts`, add this test. It uses the file's `input(ai, overrides)` helper; import `fakeAi`, `textReply` and `AiError` if the file doesn't already.

```ts
  it("reports the model that last answered, or none when no call came back", async () => {
    // A server-side fallback can answer with another model than the one asked for (spec §6.4).
    const answered = await runCoachLoop(input(fakeAi([{ ...textReply("Hi"), model: "claude-sonnet-5-5" }])));
    expect(answered.model).toBe("claude-sonnet-5-5");
    const silent = await runCoachLoop(input(fakeAi([new AiError("api_error", "overloaded")])));
    expect(silent.model).toBeNull();
  });
```

In `server/test/messages.test.ts`, the two direct `processMessage({ … })` calls gain `dailyCallCap: 200`.

In `server/test/config.test.ts`:
- The first test's `toMatchObject` gains `aiDailyCallCap: 200, guestDailyCallCap: 60`.
- Add:

```ts
  it("reads the owner's and each guest's daily call caps", () => {
    const c = loadConfig({ ...production, AI_DAILY_CALL_CAP: "150", GUEST_DAILY_CALL_CAP: "25" });
    expect([c.aiDailyCallCap, c.guestDailyCallCap]).toEqual([150, 25]);
    expect(() => loadConfig({ ...production, GUEST_DAILY_CALL_CAP: "0" })).toThrow(ConfigError);
  });
```

In `web/src/format.test.ts`:
- "explains every code the server can record": add `"ai_cap"` to `codes`, and add `expect(failureText("ai_cap")).toBe("Today's coach limit is used up. You can still add things by hand.");`.
- "falls back for null, unknown codes…": remove `"ai_cap"` from its list.

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test --workspace server -- cap db datadir coach-loop messages config` and `npm test --workspace web -- format`.

Expected: FAIL. `usage.ts` and `aiUsage` don't exist, there is no cap, and `failureText("ai_cap")` falls back.

- [ ] **Step 3: Implement**

`server/src/db/schema.ts`: append

```ts
/**
 * One row per coach run that reached Claude, success or failure: what the daily cap counts (spec §6.4). `date` is the
 * person's local date when the run started; `model` the model that last answered. Kept when its message is deleted.
 */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    message_id: text().notNull(),
    model: text(),
    calls: integer().notNull(),
    input_tokens: integer().notNull(),
    output_tokens: integer().notNull(),
    cache_read_tokens: integer().notNull(),
    cache_write_tokens: integer().notNull(),
    created_at: text().notNull(),
  },
  (t) => [index("ai_usage_date_idx").on(t.date)],
);
```

Then generate the migration: `npm run db:generate --workspace server -- --name=ai_usage`.

Expected: a new `server/drizzle/0003_ai_usage.sql` holding exactly one `CREATE TABLE \`ai_usage\`` with these ten columns and one `CREATE INDEX \`ai_usage_date_idx\``. The generator also adds `meta/0003_snapshot.json` and a fourth `_journal.json` entry. Commit them as generated.

Create `server/src/coach/usage.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq, sql as rawSql } from "drizzle-orm";
import type { AiUsage } from "../ai/client.ts";
import { aiUsage } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";

/** One coach run that reached Claude, as the daily cap counts it (2.2 §6). */
export interface CoachRun {
  messageId: string;
  /** The person's local date when the run started: the day its calls count against. */
  date: string;
  /** The model that last answered; null when no call came back. */
  model: string | null;
  calls: number;
  usage: AiUsage;
  nowIso: string;
}

export function recordRun(sql: Sql, run: CoachRun): void {
  sql
    .insert(aiUsage)
    .values({
      id: randomUUID(),
      date: run.date,
      message_id: run.messageId,
      model: run.model,
      calls: run.calls,
      input_tokens: run.usage.input_tokens,
      output_tokens: run.usage.output_tokens,
      cache_read_tokens: run.usage.cache_read_input_tokens,
      cache_write_tokens: run.usage.cache_creation_input_tokens,
      created_at: run.nowIso,
    })
    .run();
}

/** Model calls made on a local date: what the daily cap compares with its limit. */
export function callsOn(sql: Sql, date: string): number {
  const row = sql
    .select({ calls: rawSql<number>`coalesce(sum(${aiUsage.calls}), 0)`.mapWith(Number) })
    .from(aiUsage)
    .where(eq(aiUsage.date, date))
    .get();
  return row?.calls ?? 0;
}
```

`server/src/coach/loop.ts`:

1. `LoopResult` becomes:

   ```ts
   export type LoopResult =
     | { ok: true; turns: AiMessage[]; replyText: string; calls: number; usage: AiUsage; model: string | null }
     | { ok: false; failure: CoachFailure; calls: number; usage: AiUsage; model: string | null; detail?: string };
   ```

2. In `runCoachLoop`, add `let model: string | null = null;` after `let calls = 0;`.

3. Right after the line that adds `response.usage` into `usage`, add `model = response.model;`.

4. Every `return { … }` in the function gains `model`. As of 2.1 there are six: the `AiError` catch, `refused`, `max_tokens`, the empty turn, the `ok: true` reply and `tool_loop_limit`.

`server/src/coach/process.ts`:

1. Add `import { callsOn, recordRun } from "./usage.ts";`.

2. `CoachDeps` gains:

   ```ts
     /** Model calls this person may start per local day (2.2 §6): AI_DAILY_CALL_CAP for the owner, GUEST_DAILY_CALL_CAP for a guest. */
     dailyCallCap: number;
   ```

3. `ProcessOutcomeCode` gains `| "ai_cap"`.

4. `fail` keeps only what its callers still pass:

   ```ts
   /** A failure before Claude was called: nothing to count against the cap. */
   function fail(sql: Sql, id: string, outcome: ProcessOutcomeCode): ProcessOutcome {
     setMessageStatus(sql, id, "failed", outcome);
     return { outcome, calls: 0, usage: null };
   }
   ```

5. Right after `const today = todayIn(profile.timezone, now);`, add:

   ```ts
     // Checked before the first call: a run that starts under the cap may end a few calls over it (2.2 §6).
     if (callsOn(deps.db, today) >= deps.dailyCallCap) return fail(deps.db, messageId, "ai_cap");
   ```

6. Replace `if (!result.ok) return fail(deps.db, messageId, result.failure, result.calls, result.usage, result.detail);` with:

   ```ts
     // Every run that reached Claude counts against the cap, a failed one too, so retrying can't run up the bill.
     const run = { messageId, date: today, model: result.model, calls: result.calls, usage: result.usage };
     if (!result.ok) {
       deps.db.transaction((tx) => {
         recordRun(tx, { ...run, nowIso: deps.now().toISOString() });
         setMessageStatus(tx, messageId, "failed", result.failure);
       });
       return { outcome: result.failure, calls: result.calls, usage: result.usage, detail: result.detail };
     }
   ```

7. In the success transaction, add `recordRun(tx, { ...run, nowIso: doneIso });` before `setMessageStatus(tx, messageId, "done", null);`.

`server/src/config.ts`:

1. `Config` gains:

   ```ts
     /** Model calls a day for the owner (AI_DAILY_CALL_CAP) and for each guest (GUEST_DAILY_CALL_CAP) (2.2 §6). */
     aiDailyCallCap: number;
     guestDailyCallCap: number;
   ```

2. The returned object gains:

   ```ts
       aiDailyCallCap: positiveInt(env, "AI_DAILY_CALL_CAP", 200),
       guestDailyCallCap: positiveInt(env, "GUEST_DAILY_CALL_CAP", 60),
   ```

`server/src/deps.ts`: `AppDeps` gains:

```ts
  /** Model calls a day: the owner's cap and each guest's (2.2 §6). */
  callCaps: { owner: number; guest: number };
```

`server/src/routes/messages.ts`: in `runSafely`, the `processMessage` call's dependencies gain:

```ts
dailyCallCap: deps.person.owner ? deps.callCaps.owner : deps.callCaps.guest,
```

`server/src/main.ts`: `buildApp({…})` gains:

```ts
callCaps: { owner: config.aiDailyCallCap, guest: config.guestDailyCallCap },
```

`server/test/helpers.ts`:
- Add `export const TEST_CAPS = { owner: 200, guest: 60 };`.
- `testApp`'s options gain `callCaps?: { owner: number; guest: number }`, and its `buildApp` call gains `callCaps: opts.callCaps ?? TEST_CAPS,`.
- The three direct `buildApp` calls in `app.test.ts` and `logging.test.ts` gain `callCaps: TEST_CAPS`, imported from `./helpers.ts`.

`web/src/format.ts`: `FAILURES` gains, after `ai_rate_limited`:

```ts
  ai_cap: "Today's coach limit is used up. You can still add things by hand.",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test --workspace server -- cap db datadir coach-loop messages config` and `npm test --workspace web -- format`. Expected: PASS.

Then run the full `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

Finally, run `grep -c "CREATE" server/drizzle/0003_ai_usage.sql`. Expected: `2`.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.ts server/drizzle/0003_ai_usage.sql server/drizzle/meta/0003_snapshot.json server/drizzle/meta/_journal.json server/src/coach/usage.ts server/src/coach/loop.ts server/src/coach/process.ts server/src/config.ts server/src/deps.ts server/src/routes/messages.ts server/src/main.ts server/test/helpers.ts server/test/app.test.ts server/test/logging.test.ts server/test/cap.test.ts server/test/db.test.ts server/test/datadir.test.ts server/test/coach-loop.test.ts server/test/messages.test.ts server/test/config.test.ts web/src/format.ts web/src/format.test.ts
git commit -m "feat: a daily coach cap per person — 200 calls for the owner, 60 for a guest, counted in ai_usage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Each person's featured activities

**Files:**
- Create: `server/src/days/featured.ts`, `server/test/featured.test.ts`
- Modify:
  - `shared/src/api.ts`, `server/src/days/days.ts`
  - every `buildDayView` call in `server/src/routes/` (`days.ts`, `entries.ts`, `messages.ts`), and the one in `server/src/coach/process.ts`
  - `server/test/days.test.ts`, `server/test/coach-context.test.ts`
  - `web/src/components/SportBadge.tsx`, `web/src/components/EntryEditor.tsx`, `web/src/pages/TodayPage.tsx`, `web/src/test/fixtures.ts`
- Test: `web/src/components/SportBadge.test.tsx`, `web/src/components/EntryEditor.test.tsx`, `web/src/pages/TodayPage.test.tsx`

**Interfaces:**
- Consumes (Task 4): `RequestDeps.person.owner`; `testApp({ guests })`, `storeOf`, `headersFor`.
- Produces:

```ts
// server/src/days/featured.ts
export const FEATURED_COUNT = 4; export const FEATURED_DAYS = 60;
export const OWNER_STARTER: readonly Activity[]; export const GUEST_STARTER: readonly Activity[];
export function starterFor(owner: boolean): readonly Activity[]
export function featuredActivities(sql: Sql, date: string, starter: readonly Activity[]): Activity[]
// shared/src/api.ts
DayView.featured: Activity[]
// server/src/days/days.ts
buildDayView(sql, profile, date, today, nowIso, starter: readonly Activity[]): DayView
// web/src/components/SportBadge.tsx — FEATURED is removed
export const FAMILIES: readonly { name: string; activities: readonly Activity[] }[] // natural families, each activity once
export function familiesFor(featured: readonly Activity[]): { name: string; activities: readonly Activity[] }[]
// web/src/components/EntryEditor.tsx
EntryEditor({ date, entry, featured, onClose }: { date: string; entry: Entry | null; featured: readonly Activity[]; onClose: () => void })
```

- [ ] **Step 1: Write the failing tests**

Create `server/test/featured.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { entries } from "../src/db/schema.ts";
import type { Sql } from "../src/db/types.ts";
import { GUEST_STARTER, OWNER_STARTER, featuredActivities, starterFor } from "../src/days/featured.ts";
import { insertEntry } from "../src/log/entries.ts";
import type { Activity } from "../src/shared.ts";
import { NOW, openTestDb, sampleEntry, sampleExercise, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};

let db: ReturnType<typeof openTestDb> | undefined;
let t: TestApp | undefined;
afterEach(async () => {
  db?.close();
  db = undefined;
  await t?.close();
  t = undefined;
});

/** One entry on `date`, logged at `time` UTC, with one exercise for each activity given. Returns its id. */
function logged(sql: Sql, date: string, activities: Activity[], time = "07:00"): string {
  const entry = sampleEntry({
    date, logged_at: `${date}T${time}:00.000Z`, foods: [], exercises: activities.map((activity) => sampleExercise({ activity })),
  });
  insertEntry(sql, entry, NOW.toISOString());
  return entry.id;
}

describe("featuredActivities", () => {
  it("is the four activities with the most exercises, ties going to the most recently logged", () => {
    db = openTestDb();
    logged(db.db, "2026-10-01", ["running", "running"]);
    logged(db.db, "2026-10-02", ["running", "golf"]);
    logged(db.db, "2026-09-20", ["tennis", "tennis"]);
    logged(db.db, "2026-09-25", ["yoga", "yoga"]);
    logged(db.db, "2026-09-30", ["cycling"], "06:00");
    logged(db.db, "2026-09-30", ["cycling"], "18:00");
    // running 3; then 2 each for cycling (last on the 30th), yoga (the 25th) and tennis (the 20th); golf 1.
    expect(featuredActivities(db.db, "2026-10-03", OWNER_STARTER)).toEqual(["running", "cycling", "yoga", "tennis"]);
  });

  it("counts the 60 days ending on the viewed day, and nothing after it", () => {
    db = openTestDb();
    logged(db.db, "2026-08-04", ["golf", "golf", "golf"]); // 61 days back, counting the 3rd itself: outside
    logged(db.db, "2026-08-05", ["boxing"]); // the 60th day: inside
    logged(db.db, "2026-10-04", ["skiing", "skiing"]); // after the viewed day
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual(["boxing", "running", "walking", "cycling"]);
  });

  it("never features other, or an entry that was deleted", () => {
    db = openTestDb();
    logged(db.db, "2026-10-03", ["other", "other", "other"]);
    const gone = logged(db.db, "2026-10-03", ["rowing"]);
    db.db.update(entries).set({ deleted_at: NOW.toISOString() }).where(eq(entries.id, gone)).run();
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual([...GUEST_STARTER]);
  });

  it("fills up from the starter set, skipping what is already there", () => {
    db = openTestDb();
    logged(db.db, "2026-10-03", ["gym"]);
    expect(featuredActivities(db.db, "2026-10-03", GUEST_STARTER)).toEqual(["gym", "running", "walking", "cycling"]);
    expect(featuredActivities(db.db, "2026-10-03", OWNER_STARTER)).toEqual(["gym", "tennis", "wakeboarding", "kitesurfing"]);
  });

  it("starts the owner on their four sports and everyone else on everyday ones", () => {
    expect(starterFor(true)).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
    expect(starterFor(false)).toEqual(["running", "walking", "cycling", "gym"]);
  });
});

describe("the day view's featured activities", () => {
  it("are each person's own", async () => {
    t = await testApp({ guests: ["friend@example.com"] });
    const guest = await t.headersFor("friend@example.com");
    for (const headers of [t.headers, guest]) await t.app.inject({ method: "PUT", url: "/api/profile", headers, payload: PROFILE });
    logged(t.storeOf("friend@example.com").db, "2026-10-02", ["climbing"]);
    const ownersDay = await t.app.inject({ method: "GET", url: "/api/days/today", headers: t.headers });
    const guestsDay = await t.app.inject({ method: "GET", url: "/api/days/today", headers: guest });
    expect(ownersDay.json().featured).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
    expect(guestsDay.json().featured).toEqual(["climbing", "running", "walking", "cycling"]);
  });
});
```

In `web/src/components/SportBadge.test.tsx`:
- Import `familiesFor` instead of `FEATURED`.
- Replace "features the owner's four sports" and "puts every activity in exactly one family, in the vocabulary's order" with:

```ts
  it("puts every activity in exactly one family", () => {
    const listed = FAMILIES.flatMap((family) => family.activities);
    expect([...listed].sort()).toEqual([...ACTIVITIES].sort());
    expect(new Set(listed).size).toBe(ACTIVITIES.length);
    expect(FAMILIES.map((family) => family.name)).toEqual([
      "Racket", "On foot and wheels", "Water", "Gym, combat and mind", "Team", "Snow and ice", "Everything else",
    ]);
  });

  it("leads the grid with the person's own four, and lists every other activity once, in its family", () => {
    const grid = familiesFor(["running", "walking", "cycling", "gym"]);
    expect(grid[0]).toEqual({ name: "Your sports", activities: ["running", "walking", "cycling", "gym"] });
    const listed = grid.flatMap((family) => family.activities);
    expect([...listed].sort()).toEqual([...ACTIVITIES].sort());
    expect(grid.find((family) => family.name === "Racket")?.activities).toEqual(["tennis", "padel", "badminton"]);
    expect(grid.find((family) => family.name === "On foot and wheels")?.activities).toEqual(["hiking", "photography", "skateboarding"]);
  });

  it("drops a family that the person's four have emptied", () => {
    const grid = familiesFor(["skiing", "snowboarding", "skating", "golf"]);
    expect(grid.map((family) => family.name)).not.toContain("Snow and ice");
    expect(grid.find((family) => family.name === "Everything else")?.activities).toEqual(["other"]);
  });
```

In `web/src/components/EntryEditor.test.tsx`:

1. Add `import type { Activity } from "../shared.ts";` and `const FOUR: Activity[] = ["tennis", "gym", "wakeboarding", "kitesurfing"];`.

2. Give every render the prop: `sed -i '' 's/<EntryEditor date=/<EntryEditor featured={FOUR} date=/g' web/src/components/EntryEditor.test.tsx`. Then run `grep -c "featured={FOUR}"` on the file. Expected: the number of renders, 21 as of 2.1.

3. Any assertion on the old family name "Combat, body and mind" now looks for "Gym, combat and mind". In the More grid, tennis now sits under Racket, wakeboarding and kitesurfing under Water, and gym under "Gym, combat and mind". When `featured` is FOUR, those four appear only under "Your sports".

4. Add:

```ts
  it("features the person's own four, and keeps every other activity in the grid", async () => {
    mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<EntryEditor featured={["running", "walking", "cycling", "gym"]} date="2026-10-03" entry={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const picker = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(picker).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Running", "Walking", "Cycling", "Gym", "Other"]);
    await userEvent.click(within(picker).getByRole("button", { name: "More" }));
    expect(within(picker).getByText("Your sports")).toBeInTheDocument();
    expect(within(picker).getAllByRole("radio", { name: "Running" })).toHaveLength(1); // once, under Your sports
    expect(within(picker).getByRole("radio", { name: "Tennis" })).toBeInTheDocument(); // in Racket now
  });
```

In `web/src/pages/TodayPage.test.tsx`, add:

```ts
  it("offers the day's featured activities in the editor", async () => {
    mockFetch(() => jsonResponse(dayView({ featured: ["climbing", "running", "walking", "cycling"] })));
    renderDay();
    await userEvent.click(await screen.findByRole("button", { name: "+ Add manually" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const picker = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(picker).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Climbing", "Running", "Walking", "Cycling", "Other"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test --workspace server -- featured` and `npm test --workspace web -- SportBadge EntryEditor TodayPage`.

Expected: FAIL. `featured.ts` and `familiesFor` don't exist, the editor ignores `featured`, and the day view has none.

- [ ] **Step 3: Implement**

Create `server/src/days/featured.ts`:

```ts
import { and, asc, count, desc, eq, gte, isNull, lte, max, ne } from "drizzle-orm";
import { entries, exerciseItems } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { ACTIVITIES, addDays } from "../shared.ts";
import type { Activity } from "../shared.ts";

/** The editor features four activities, from the 60 days ending on the viewed day (2.2 §7). */
export const FEATURED_COUNT = 4;
export const FEATURED_DAYS = 60;

/** What fills the row until someone has logged four activities of their own. */
export const OWNER_STARTER: readonly Activity[] = ["tennis", "gym", "wakeboarding", "kitesurfing"];
export const GUEST_STARTER: readonly Activity[] = ["running", "walking", "cycling", "gym"];

export function starterFor(owner: boolean): readonly Activity[] {
  return owner ? OWNER_STARTER : GUEST_STARTER;
}

const KNOWN = new Set<string>(ACTIVITIES);

/**
 * The editor's featured row: the activities with the most exercise items over the 60 days ending on `date`, ties going
 * to the most recently logged, then filled from `starter`, skipping repeats. `other` is never featured: it is no sport,
 * and the picker shows an exercise's own activity anyway.
 */
export function featuredActivities(sql: Sql, date: string, starter: readonly Activity[]): Activity[] {
  const rows = sql
    .select({ activity: exerciseItems.activity })
    .from(exerciseItems)
    .innerJoin(entries, eq(entries.id, exerciseItems.entry_id))
    .where(
      and(
        gte(entries.date, addDays(date, 1 - FEATURED_DAYS)),
        lte(entries.date, date),
        isNull(entries.deleted_at),
        ne(exerciseItems.activity, "other"),
      ),
    )
    .groupBy(exerciseItems.activity)
    .orderBy(desc(count(exerciseItems.id)), desc(max(entries.logged_at)), asc(exerciseItems.activity))
    .all();
  const featured = rows
    .map((row) => row.activity)
    .filter((activity): activity is Activity => KNOWN.has(activity))
    .slice(0, FEATURED_COUNT);
  for (const activity of starter) {
    if (featured.length === FEATURED_COUNT) break;
    if (!featured.includes(activity)) featured.push(activity);
  }
  return featured;
}
```

`shared/src/api.ts`: `DayView` gains, after `messages`:

```ts
  /** The editor's featured activities for this person: their four most-logged over the 60 days ending on this day, filled from a starter set (spec §11.1). */
  featured: Activity[];
```

`Activity` is already imported from `./vocab.ts`.

`server/src/days/days.ts`:
- Add `import { featuredActivities } from "./featured.ts";` and `import type { Activity } from "../shared.ts";`, or extend the existing type import.
- `buildDayView`'s signature becomes `(sql: Sql, profile: Profile, date: string, today: string, nowIso: string, starter: readonly Activity[]): DayView`.
- Its returned object gains `featured: featuredActivities(sql, date, starter),` after `messages,`.

The call sites:
- Every `buildDayView(…)` call in `server/src/routes/` gains a last argument, `starterFor(deps.person.owner)`. Import `starterFor` from `../days/featured.ts`. Find them with `grep -n "buildDayView(" server/src/routes/*.ts`.
- In `server/src/coach/process.ts`, the call gains `[]` with the comment `// The coach's context never shows the featured row.`
- In `server/test/days.test.ts` and `server/test/coach-context.test.ts`, every direct `buildDayView(…)` call gains `[]` as its last argument.

`web/src/components/SportBadge.tsx`: replace `FEATURED` and `FAMILIES` with:

```ts
/** Every activity in its family, each once, in the order the editor's More grid shows them (spec §11.1). */
export const FAMILIES: readonly { name: string; activities: readonly Activity[] }[] = [
  { name: "Racket", activities: ["tennis", "padel", "badminton"] },
  { name: "On foot and wheels", activities: ["running", "walking", "hiking", "photography", "cycling", "skateboarding"] },
  { name: "Water", activities: ["swimming", "surfing", "wakeboarding", "kitesurfing", "rowing", "kayaking", "sailing", "diving"] },
  { name: "Gym, combat and mind", activities: ["gym", "boxing", "martial_arts", "yoga", "climbing"] },
  { name: "Team", activities: ["football", "basketball", "volleyball", "rugby", "cricket", "hockey"] },
  { name: "Snow and ice", activities: ["skiing", "snowboarding", "skating"] },
  { name: "Everything else", activities: ["golf", "other"] },
];

/**
 * The More grid for someone: their featured four as "Your sports", then every other activity in its family, so each
 * appears once (one radio per activity); a family the four have emptied is left out.
 */
export function familiesFor(featured: readonly Activity[]): { name: string; activities: readonly Activity[] }[] {
  const rest = FAMILIES.map((family) => ({ name: family.name, activities: family.activities.filter((activity) => !featured.includes(activity)) }));
  return [{ name: "Your sports", activities: featured }, ...rest.filter((family) => family.activities.length > 0)];
}
```

`web/src/components/EntryEditor.tsx`:

1. Import `familiesFor` instead of `FAMILIES` and `FEATURED`, and add `Activity` to the type imports from `../shared.ts` if it isn't there yet.

2. Change the components:
   - `ActivityPicker`'s props become `{ exercise, value, featured, onChange }: { exercise: number; value: Activity; featured: readonly Activity[]; onChange: (value: Activity) => void }`.
   - Its `shown` becomes `featured.includes(value) ? featured : [...featured, value]`.
   - Its grid maps `familiesFor(featured)` instead of `FAMILIES`.
   - `ExerciseRow` takes `featured` and passes it to `ActivityPicker`.
   - `EntryEditor` takes `featured` and passes it to each `ExerciseRow`.
   - The `EntryEditor` signature becomes `export function EntryEditor({ date, entry, featured, onClose }: { date: string; entry: Entry | null; featured: readonly Activity[]; onClose: () => void })`.

3. The picker's doc comment, "the owner's four", becomes "the person's featured four".

`web/src/pages/TodayPage.tsx`: the `<EntryEditor … />` render gains `featured={view.featured}`.

`web/src/test/fixtures.ts`: `dayView`'s defaults gain `featured: ["tennis", "gym", "wakeboarding", "kitesurfing"],` before `...overrides`.

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test --workspace server -- featured days coach-context` and `npm test --workspace web`. Expected: PASS.

Then run the full `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Expected: all green.

Finally, run `grep -rn "FEATURED" web/src`. Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add server/src/days/featured.ts server/src/days/days.ts shared/src/api.ts server/src/routes/days.ts server/src/routes/entries.ts server/src/routes/messages.ts server/src/coach/process.ts server/test/featured.test.ts server/test/days.test.ts server/test/coach-context.test.ts web/src/components/SportBadge.tsx web/src/components/SportBadge.test.tsx web/src/components/EntryEditor.tsx web/src/components/EntryEditor.test.tsx web/src/pages/TodayPage.tsx web/src/pages/TodayPage.test.tsx web/src/test/fixtures.ts
git commit -m "feat: each person's featured activities — their four most-logged, filled from a starter set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, the environment, and revision 5 of the design

**Files:**
- Modify: `README.md`, `k8s/30-app.yaml`, `docs/superpowers/specs/2026-10-03-fitnessai-design.md`, `docs/superpowers/specs/2026-10-05-fitnessai-friends-and-family-design.md`

**Interfaces:** none. Names used verbatim:
- `ALLOWED_EMAILS`, `AI_DAILY_CALL_CAP`, `GUEST_DAILY_CALL_CAP`
- `/data/users/<key>/`
- `fitness_emails`
- `fitnessai-secrets`

- [ ] **Step 1: `k8s/30-app.yaml`**

After the `OWNER_EMAIL` env entry, add:

```yaml
            - name: ALLOWED_EMAILS
              valueFrom:
                secretKeyRef:
                  name: fitnessai-secrets
                  key: ALLOWED_EMAILS
                  optional: true
            - name: AI_DAILY_CALL_CAP
              value: "200"
            - name: GUEST_DAILY_CALL_CAP
              value: "60"
```

`optional: true` keeps the pod starting before the key exists; the owner alone gets in.

- [ ] **Step 2: `README.md`**

1. **Develop:** the `dev:server` comment becomes `# http://localhost:8080, signed in as dev@localhost (the owner), data in .data/`.

2. **Configuration:**
   - The Access row's purpose becomes "Cloudflare Access verification; `OWNER_EMAIL` is the owner".
   - The `DATA_DIR` row's purpose becomes "Everyone's databases, photos and snapshots".
   - Add these rows after the Access row:

   ```markdown
   | `ALLOWED_EMAILS` | unset (the owner alone) | Friends and family who may also sign in, comma-separated (see [Friends and family](#friends-and-family)) |
   | `AI_DAILY_CALL_CAP` / `GUEST_DAILY_CALL_CAP` | `200` / `60` | Claude calls a day for the owner / for each guest |
   ```

3. **A new section** after "## Deploy":

   ```markdown
   ## Friends and family

   Each person signs in with their own email and gets the whole app, with a database of their own that nobody
   else sees — the owner included. Guests get the coach too, up to `GUEST_DAILY_CALL_CAP` calls a day (about
   20–30 messages); every call is billed to the owner's Anthropic key.

   **Adding someone** — both lists, because the app checks its own as well as Cloudflare's:

   1. `sops k8s/80-secrets.sops.yaml` and add the email to `ALLOWED_EMAILS` (comma-separated). Commit and push
      only the encrypted file.
   2. In home-cluster, add it to `fitness_emails` in `terraform/cloudflare/terraform.tfvars` (never committed)
      and run `terraform apply` there.
   3. Once Flux has applied the secret, restart the app: `kubectl -n fitnessai rollout restart deploy/fitnessai`.
   4. They open <https://fitness.minipi.net>, sign in with the emailed code, add it to their home screen and set
      up their profile.

   **Removing someone:** take the email out of both lists and restart. They can no longer sign in. Their folder
   stays until you delete it — on rpi-01, in the PVC's directory: `sudo rm -rf users/<key>`, where `<key>` is
   `printf %s 'friend@example.com' | sha256sum`. Their snapshots age out of the backups under the 6-month
   retention.

   **For invitees** (send this with the invite): your entries, photos and coach conversations are stored on the
   owner's home server, and what you send the coach goes to Anthropic under the owner's account. Conversations
   and photos are deleted after 48 hours; the numbers you log are kept.
   ```

4. **Data, backups and restore:**
   - The layout block becomes:

     ```
     /data/users/<key>/db/fitness.db   a person's live database — never backed up (CACHEDIR.TAG)
     /data/users/<key>/photos/         their photos, deleted after 48 hours — never backed up (CACHEDIR.TAG)
     /data/users/<key>/snapshots/      what the backups keep
     ```

   - Add under the block: "`<key>` is the sha256 of the person's email in lowercase hex: `printf %s 'friend@example.com' | sha256sum`. The owner's folder is the sha256 of `OWNER_EMAIL`."
   - The bullets say "every person's" where they say "the app deletes" and "the app writes".
   - The restore commands become `sudo cp users/<key>/snapshots/fitness-YYYY-MM-DD.db users/<key>/db/fitness.db`, `sudo rm -f users/<key>/db/fitness.db-journal` and `sudo chown 1000:1000 users/<key>/db/fitness.db`.

5. **Rolling back to milestone 2.1:** add a new paragraph before the milestone 1 one:

   ````markdown
   **Rolling back to milestone 2.1.** Milestone 2.1 has one database at `/data/db/fitness.db`; milestone 2.2
   moved it, the photos and the snapshots into the owner's folder. Move them back first:

   ```bash
   flux suspend kustomization fitnessai
   kubectl -n fitnessai scale deploy/fitnessai --replicas=0
   # on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s; <owner key> is the sha256 of OWNER_EMAIL:
   sudo mv users/<owner key>/db users/<owner key>/photos users/<owner key>/snapshots .
   # revert milestone 2.2's Deploy commit on main and push it, then fetch it before resuming,
   # so Flux never re-applies milestone 2.2 to the moved data:
   flux reconcile source git fitnessai
   flux resume kustomization fitnessai
   kubectl -n fitnessai scale deploy/fitnessai --replicas=1
   ```

   Guests' folders stay in `users/`, untouched; milestone 2.1 ignores them.
   ````

6. **The milestone 1 paragraph:** its first sentence becomes "Milestone 1 reads `/data/fitness.db`; milestone 2 moved it into `db/`. Roll back to milestone 2.1 first (above), then move it back, in this order:".

- [ ] **Step 3: The main design, revision 5** (`docs/superpowers/specs/2026-10-03-fitnessai-design.md`)

Make these edits, word for word.

1. **Header table:**
   - **Date** becomes `2026-10-03, revised 2026-10-05`.
   - **Status** becomes `Approved. Milestones 1, 2 and 2.1 are live.`
   - **Revision** becomes `5 — milestone 2.2: friends and family, each with a database of their own, an allowlist, a daily coach cap per person and their own featured activities (revision 4 brought instant replies with live steps, the activities card, the calendar, 33 activities and the zabaione-ball icon)`.

2. **§1:**
   - "fitnessAI is a single-user, mobile-first web app (PWA)" becomes "fitnessAI is a personal, mobile-first web app (PWA)".
   - After the first paragraph, add a paragraph: "The owner can invite a few friends and family (milestone 2.2): each gets the whole app, the coach included, and their own data, which nobody else sees."

3. **§2, Non-goals:** "- Multiple users, sharing, social features." becomes "- Open sign-up, sharing between people, social features (invited friends and family each keep their own data — milestone 2.2)."

4. **§3, D1:**
   - The decision becomes "PWA, mobile-first; the owner plus a few invited people, each with their own data (D23)".
   - Its why becomes "Logging happens on the phone; no app store; one owner, who invites."

5. **§3, after D22:** add

   ```markdown
   | D23 | One database per person: a folder per person named by the sha256 of their email, holding their own SQLite database, photos and snapshots (§14.4) | Separation by construction: every query works unchanged on "this person's database", and no forgotten filter can show one person another's data. A user column on every table would touch every query and two primary keys, and one missed condition would leak someone's health notes. |
   | D24 | Two allowlists, Cloudflare Access's `fitness_emails` and the app's `ALLOWED_EMAILS`; people are added and removed by editing them (no admin screen) | Defence in depth, as with the owner alone, and no new attack surface for a handful of testers. |
   | D25 | Everyone gets the coach, with a daily cap on model calls per person: `AI_DAILY_CALL_CAP` (200) for the owner, `GUEST_DAILY_CALL_CAP` (60) for each guest | Every call is billed to the owner's key; the cap bounds what one guest can cost. |
   | D26 | The editor's featured activities are each person's four most-logged over the last 60 days, filled from a starter set | The owner's four sports mean nothing to a friend who only runs. |
   ```

6. **§4.1:**
   - The `auth` row's responsibility becomes "Verifies the Access JWT: the owner or an allowed email for app routes, service token for ingest".
   - Add after the `db` row: `| \`people\` | One database and photo folder per person, opened on first use and kept open (§14.4) | \`db\` |`.
   - The `jobs` row becomes "In-process scheduler for the snapshot and retention jobs, run for every person" with dependencies "`db`, `retention`, `people`".

7. **§5:**
   - The intro's first word "SQLite." becomes "SQLite, one database per person (§14.4): every table below is that person's, and `profile`'s one row is theirs."
   - The `ai_usage` paragraph becomes: "**`ai_usage`** — one row per coach run that reached Claude, success or failure: `id`, `date` (the person's local date when the run started: the day its calls count against), `message_id`, `model` (the model that last answered; null when none did), `calls` (model calls made), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `created_at`; `cost_usd_estimate` arrives with the cost display (milestone 3). Kept when its message is deleted, so the cap and cost history survive (milestone 2.2)."

8. **§6.3:**
   - Step 3 becomes: "3. If the person's model calls today — their local day, summed from `ai_usage` — have reached their cap (§6.4), mark the message `failed` with `ai_cap`, with no AI call. A run that starts under the cap may finish up to `MAX_MODEL_CALLS − 1` calls over it. The bubble says \"Today's coach limit is used up. You can still add things by hand.\""
   - The failure paragraph's first sentence gains ", and a run that reached Claude records its `ai_usage` row too" before its full stop.

9. **§6.4:** the cap bullet becomes "- `AI_DAILY_CALL_CAP` (default 200) limits the owner's Claude API calls — each model call in a tool loop counts — per local day, guarding against a runaway retry loop; `GUEST_DAILY_CALL_CAP` (default 60) is each guest's (milestone 2.2). At the cap, manual logging, the activities card and the calendar keep working; it resets at the person's local midnight."

10. **§6.6:** the first bullet gains a closing sentence: "The job runs for every person's database in turn (milestone 2.2)."

11. **§10.2:** add a closing sentence: "The ingest writes to the owner's database (milestone 2.2)."

12. **§11.1:** the picker sentence becomes: "The editor picks an exercise's activity from the person's featured four — their most-logged over the 60 days ending on the viewed day, ties going to the most recent, filled from a starter set (the owner's tennis, gym, wakeboarding and kitesurfing; everyone else's running, walking, cycling and gym) — the entry's current activity if it is another, and **More**, which opens every activity in a grid by family, led by the four as \"Your sports\" (§5.1); picking one folds the grid away."

13. **§12:** in the `GET /api/days/:date` row, after "messages," insert "the person's `featured` activities (§11.1),".

14. **§13, the Access application bullet:** "the owner's email, one-time PIN" becomes "the owner's email and the invited ones (`fitness_emails`), one-time PIN".

15. **§13, app routes:** "App routes require audience `ACCESS_AUD` and `email == OWNER_EMAIL`, so even a loosened Access policy admits only the owner." becomes "App routes require audience `ACCESS_AUD` and an email that is `OWNER_EMAIL` or on `ALLOWED_EMAILS`, so even a loosened Access policy admits only the people on the app's own list; anyone else gets the same bodiless 401 as an unsigned request. Each person's data is in their own database (§14.4), and a request only ever reaches the signed-in person's."

16. **§13, logs:** the bullet becomes "- Logs record request metadata only — never message text, photos, goals, health values or an email; a job names a person by the first 8 characters of their key."

17. **§13, prompt injection:** "the coach's tools only touch the owner's own log" becomes "the coach's tools only touch the signed-in person's own log".

18. **§14.2:**
   - The Secret becomes "`ANTHROPIC_API_KEY`, `OWNER_EMAIL` and `ALLOWED_EMAILS`".
   - The Environment list gains `ALLOWED_EMAILS` after `OWNER_EMAIL`, and `GUEST_DAILY_CALL_CAP` after `AI_DAILY_CALL_CAP`.

19. **§14.4, Location:** the bullet becomes: "**Location:** one folder per person, `/data/users/<key>/`, where `<key>` is the sha256 of the verified email in lowercase hex: `db/fitness.db` (with `db/CACHEDIR.TAG`), `photos/` (with `CACHEDIR.TAG`) and `snapshots/`. No email or other user-supplied text ever becomes part of a path. Every person's database opens at startup, so the lock wait above happens there, and a new person's on their first request; each stays open for the life of the process. Milestone 1 kept the one database at `/data/fitness.db` and milestone 2 at `/data/db/fitness.db`; the first start of milestone 2.2 moves `db/`, `photos/` and `snapshots/` into the owner's folder through a staging folder and one final rename, before opening anything and never over an existing owner's folder, and the owner's first open then takes the startup snapshot before the new migration."

20. **§14.4, other bullets:**
   - **Snapshots:** "at 03:00 in the profile timezone, `fitness-YYYY-MM-DD.db` in `/data/snapshots`" becomes "at 03:00 in the owner's timezone, for each person in turn, `fitness-YYYY-MM-DD.db` (that person's local date) in their `snapshots/`".
   - **Backups:** "The app writes one into `/data/db` and `/data/photos`" becomes "The app writes one into every person's `db/` and `photos/`".
   - **Restore:** "copy a snapshot to `db/fitness.db`" becomes "copy a person's snapshot to their `db/fitness.db`".

21. **§15, new tests block:** after the milestone 2.1 test block and before "**CI image boot test**", add:

   ```markdown
   - **Milestone 2.2:**
     - separation: two people each set up a profile, log food and exercise, message the coach (fake AI) and
       upload photos; neither sees the other's days, entries, messages, calendar summaries or photos — including
       by requesting the other's photo id — and each person's database holds only their own rows;
     - the allowlist: a correctly signed token for an email not on the list gets `401` with no body; the owner and
       every listed guest get in; listing compares case-insensitively;
     - the move: a milestone 2.1 data folder moves into the owner's folder with identical counts, and a snapshot is
       taken before the new migration; a second start moves nothing; an existing owner's folder is never
       overwritten; a move a crash cut short is finished;
     - the jobs: retention and snapshots run for each person, and one person's failure doesn't stop the others;
     - the cap: a guest is refused at 60 calls and the owner at 200 (`ai_cap`, no AI call made); failed runs count;
       the count resets at the person's local midnight; the bubble's words;
     - the featured row: the most-logged four, ties by recency, the 60-day window, the starter fill for owner and
       guest; the More grid lists each activity once.
   ```

22. **§15, live checks:** after "**Live checks before merging milestone 2.1:**", add: "- **Live checks before merging milestone 2.2:** two local test users side by side in the browser, with the owner's key on a throwaway data folder that started in milestone 2.1's layout: the owner's data arrives in their folder; each person sets up a profile, logs by hand and through the coach and uploads a photo; neither sees the other's; a guest at a lowered cap sees the limit bubble; a stranger's token gets the bare 401; no email appears in the server's log."

23. **§17:**
   - After the 2.1 paragraph, add a paragraph: "**2.2. Friends and family:** one database per person (the owner's data moved into their own folder), the allowlist, the jobs for every person, `ai_usage` and a daily coach cap per person, each person's featured activities, and the README's invite notes (D23–D26)."
   - In item 3, "the AI cap and usage tracking;" becomes "the status endpoint (calls today against the cap, month-to-date cost);".

24. **§18:** add a bullet: "- For friends and family (milestone 2.2): sharing between people; an admin page; per-person Apple Health tokens; per-person models or budgets beyond the daily cap; disk quotas."

In `docs/superpowers/specs/2026-10-05-fitnessai-friends-and-family-design.md`, the **Status** row becomes `Approved by the owner, section by section. Built in milestone 2.2 and folded into the main design as revision 5.`

- [ ] **Step 4: Check**

1. `grep -n "single-user\|email == OWNER_EMAIL\|/data/db/fitness.db\`\. Milestone 1" docs/superpowers/specs/2026-10-03-fitnessai-design.md`. Expected: no matches.
2. `grep -c "D2[3-6]" docs/superpowers/specs/2026-10-03-fitnessai-design.md`. Expected: at least 5.
3. Check that the manifest parses and holds the new variables, using `js-yaml` (already in `node_modules` through the dev tooling; nothing new is installed): `node -e "const y=require('js-yaml'); const [d]=y.loadAll(require('fs').readFileSync('k8s/30-app.yaml','utf8')); const env=d.spec.template.spec.containers[0].env.map((e)=>e.name); console.log(['ALLOWED_EMAILS','AI_DAILY_CALL_CAP','GUEST_DAILY_CALL_CAP'].every((n)=>env.includes(n)))"`. Expected: `true`.
4. `npm run lint`. Expected: green.
5. README links: `grep -n "(#friends-and-family)" README.md` matches the new heading.

- [ ] **Step 5: Commit**

```bash
git add README.md k8s/30-app.yaml docs/superpowers/specs/2026-10-03-fitnessai-design.md docs/superpowers/specs/2026-10-05-fitnessai-friends-and-family-design.md
git commit -m "docs: friends and family — the README's invite notes and layout, the environment, design revision 5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Live checks with two local users (the controller runs these)

**Files:** none committed. Scratch files live in the session's scratchpad and are deleted afterwards.

Nothing here touches the owner's real data. All the emails are `@example.com`.

- [ ] **Step 1: Make a throwaway data folder in milestone 2.1's layout**

1. `git worktree add <scratch>/m21 main`. `main` holds milestone 2.1 until Task 9 merges this branch. Then `cd <scratch>/m21 && npm ci`.
2. Start 2.1's server: `NODE_ENV=development DEV_AUTH_EMAIL=owner@example.com DATA_DIR=<scratch>/live-data PORT=8097 METRICS_PORT=9497 node server/src/main.ts`.
3. Seed it with `curl`:
   - `PUT /api/profile` with the test profile;
   - one `POST /api/entries`, "Banana", 105 kcal.
4. Stop it. Expected: `<scratch>/live-data/db/fitness.db` exists.

- [ ] **Step 2: Two people, one server**

Write `<scratch>/m22-live.mjs` and run it from `server/` so it resolves `jose`. It:
- generates an RS256 key pair;
- writes the public JWKS to `<scratch>/jwks.json`;
- mints 12-hour tokens (issuer `https://test.cloudflareaccess.com`, audience `test-aud`) for `owner@example.com`, `friend@example.com` and `stranger@example.com`, and writes them to `<scratch>/tokens.json`;
- starts two proxies, `127.0.0.1:5181` (owner) and `127.0.0.1:5182` (friend). Each forwards every request to `127.0.0.1:8098` with `cf-access-jwt-assertion` set, piping request and response bodies so streams pass through.

Then:
1. Run `npm run build`.
2. Start 2.2's server on the same data folder. The key comes from the env file, never printed. `DEV_AUTH_EMAIL=` is set empty because `--env-file` never overrides a variable that is already set:

```bash
NODE_ENV=development DEV_AUTH_EMAIL= ACCESS_TEAM_DOMAIN=test.cloudflareaccess.com ACCESS_AUD=test-aud \
OWNER_EMAIL=owner@example.com ALLOWED_EMAILS=friend@example.com GUEST_DAILY_CALL_CAP=4 \
ACCESS_TEST_JWKS="$(cat <scratch>/jwks.json)" DATA_DIR=<scratch>/live-data WEB_DIST=web/dist PORT=8098 METRICS_PORT=9498 \
node --env-file=.env server/src/main.ts > <scratch>/server.log 2>&1
```

- [ ] **Step 3: Check, in the browser pane and with curl**

1. **The move.** `server.log` says "moved the owner's data into users/". `<scratch>/live-data/users/<owner key>/snapshots/` holds one `startup-…` file. At `http://localhost:5181`, the owner's day shows the Banana.

2. **Everyday use, each separately.**
   - At `http://localhost:5182`, the guest gets the profile setup screen. They set up, add an entry by hand, and send one coach message ("two boiled eggs"). Live steps appear, and the reply logs the eggs.
   - The owner's day at 5181 doesn't change. The guest's calendar has only the guest's day.
   - The guest's editor features Running, Walking, Cycling and Gym; the owner's features Tennis, Gym, Wake and Kite.

3. **Photos.**
   - Generate a test image: `node --input-type=module -e "import { fakeJpeg } from './server/test/images.ts'; process.stdout.write(fakeJpeg(64, 48))" > <scratch>/fake.jpg`.
   - Upload it as the owner: `curl --data-binary @<scratch>/fake.jpg -H 'content-type: image/jpeg' localhost:5181/api/photos`.
   - `GET /api/photos/<id>` through 5182 gives 404.

4. **The cap.** The guest sends one more coach message (2 calls, reaching 4). The next shows "Today's coach limit is used up. You can still add things by hand." Adding by hand still works.

5. **A stranger.** `curl -i -H "cf-access-jwt-assertion: <stranger token>" localhost:8098/api/profile` gives 401 with an empty body.

6. **A restart.** Stop the server and start it again. Both people's data is intact. `grep -c "@" <scratch>/server.log` gives 0, and the job lines carry `"person":"<8 hex>"`.

7. **Phone size.** Use the pane at 375×812: the guest's setup, the day and the editor's picker.

- [ ] **Step 4: Clean up**

Stop the server and the proxies. Then remove the worktree (`git worktree remove <scratch>/m21`) and delete `<scratch>/live-data`, `jwks.json`, `tokens.json` and `server.log`.

If a check fails, fix it with a test first. The fix is its own commit, reviewed like a task.

---

### Task 9: Merge and deploy (the controller, with the owner)

**Needs from the owner, before this task starts:** the testers' email addresses, and a yes for the Cloudflare `terraform apply`. This milestone moves the owner's live data, so confirm the go-ahead for the merge and deploy even if an earlier milestone's instruction covered them.

- [ ] **Step 1: The app's allowlist**

1. Run `printf '%s' '"<comma-separated emails>"' | sops set --value-stdin k8s/80-secrets.sops.yaml '["stringData"]["ALLOWED_EMAILS"]'` (sops 3.13). The value goes in on stdin, so the addresses stay off the process list.
2. Run `sops -d k8s/80-secrets.sops.yaml | grep -c ALLOWED_EMAILS`. Expected: `1`. Never print the decrypted file.
3. Run `grep -c "ENC\[" k8s/80-secrets.sops.yaml`. Expected: 3 encrypted values.
4. Commit only the encrypted file.

- [ ] **Step 2: Cloudflare's list (home-cluster)**

1. Add the emails to `fitness_emails` in `~/Repositories/home-cluster/terraform/cloudflare/terraform.tfvars`. This file is never committed.
2. Run `terraform plan`. Show the owner its summary: one in-place change to the fitness Access policy.
3. Run `terraform apply` only after their yes.

- [ ] **Step 3: Merge and deploy**

1. Push the branch and open the pull request.
2. CI runs once. Read it with the PR tools: no polling.
3. Merge. CI's Deploy commit pins the image, and Flux rolls the pod out (`strategy: Recreate`).

- [ ] **Step 4: Verify in production**

1. The pod's log shows "moved the owner's data into users/ (milestone 2.2)", and no email anywhere in it (`kubectl logs … | grep -c "@"` gives 0).
2. On rpi-01, `users/<owner key>/snapshots/` has a fresh `startup-…` file, and `users/<owner key>/db/fitness.db` has the owner's entry count from before the deploy. Take that count (read-only) before merging.
3. The owner opens the app on their iPhone and finds their day, calendar and activities as before.
4. One tester signs in with the emailed code and sees an empty app with the setup screen.
5. The next nightly run writes one `fitness-…` snapshot per person folder.

- [ ] **Step 5: Wrap up**

1. Update the memory file `fitnessai-project.md` with 2.2's state.
2. Tell the owner what's live, the decisions made (P1–P10 and every ruling), and the invite note to send.

---

## Appendix: changes made during execution

What the reviews and rulings changed relative to the task text above. The executor's ledger has the full rulings, each with its cost if wrong; the R-numbers continue milestone 2.1's.

- **Task 1:** the existing keySetFor test now expects `{ email, owner: true }` (R29).
- **Tasks 2–3, a combined fix round:**
  - A job lists people inside its try, and both Crons have croner `catch` handlers, so a listing failure can't crash the process.
  - The log serializer shortens `users/<64 hex>` to 8 characters in message, stack and cause (R30).
  - Startup opens the owner first and fail-loud, then every guest after `buildApp`, each guarded, then calls `People.stopWaitingForLocks()`, so only startup waits for an old pod's lock (R31).
  - `store()` closes its handle if `failInterrupted` throws.
  - `personPaths` checks the key (`PERSON_KEY`).
  - `moveOwnerIn` treats an empty owner folder (left by a rollback) as absent.
  - `close()` is exception-safe.
  - Missing tests were added (R32, R33).
- **Task 4:** the separation test checks the real photo folders and that a stranger creates nothing (R36).
- **Task 5:**
  - The cap is accepted as a soft limit under parallel sends (R34).
  - A streamed `ai_cap` test and three pins were added: refusal side effects, the run-day date, the last-answering model (R35, R37).
- **Task 6:** the reworded editor test title (R40).
- **Task 7:** two extra README sentences (R41).
- **Final fix wave:**
  - `view.featured ?? []`, and `familiesFor` drops empty families, so an older server can't blank the editor.
  - Pins for each person's starter on every route (including the streamed send and Retry), "Your sports" membership, the KNOWN filter, and request-path isolation.
  - A README and spec docs pass (R42–R44): the rollback waits for the pod, checks the database before reverting and removes the emptied owner folder; removal guards an empty key; P8 is stated.
- **Merge:** merged as soon as it was open, since the same checks ran green locally and main re-verifies (R45).
