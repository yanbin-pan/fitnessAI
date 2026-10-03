# fitnessAI Milestone 1 — Foundation and Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, installable fitnessAI in which the owner logs food and exercise by messaging the coach (text) or by hand, sees calculated and exercise-adjusted targets for any day, and the app runs on the home cluster behind Cloudflare Access.

**Architecture:** One TypeScript monorepo with three npm workspaces (`shared/`, `server/`, `web/`). Fastify serves the JSON API and the built React PWA from a single container; SQLite (Drizzle on better-sqlite3) lives on the `ssd` PVC. The server runs TypeScript directly through Node 24's type stripping, so it has no build step. The coach is a Claude tool loop whose writes are staged in memory and committed in one transaction together with the conversation turns and the reply.

**Tech Stack:** Node 24, TypeScript 6.0, Fastify 5, @fastify/static 10, Drizzle ORM 0.45 + better-sqlite3 13, Zod 4, jose 6, @anthropic-ai/sdk 0.131, croner 10, prom-client 15 · React 19, Vite 8, Tailwind 4, TanStack Query 5, React Router 7, vite-plugin-pwa 1.3 · Vitest 5, Testing Library, jsdom · GitHub Actions, GHCR, Kustomize, Flux, SOPS/age, Terraform (Cloudflare provider v5).

**Spec:** `docs/superpowers/specs/2026-10-03-fitnessai-design.md` (revision 2). This plan implements milestone 1 (spec §17, item 1). Read the spec before starting; section numbers below (§n) refer to it.

## Global Constraints

- **Node 24 everywhere:** `.nvmrc`, Docker base `node:24-slim`, CI `actions/setup-node` with `node-version: 24`.
- **Every image is `linux/arm64`.** The cluster is four Raspberry Pi 4s.
- **Server TypeScript must stay runnable by Node's type stripping:** `.ts` extensions on every relative import, `import type` for type-only imports, no `enum`, no `namespace`, no constructor parameter properties. `verbatimModuleSyntax` and `erasableSyntaxOnly` in `tsconfig.base.json` enforce this — never turn them off.
- **Pinned majors:** TypeScript `~6.0.3` (typescript-eslint 8 supports `<6.1.0`), ESLint `^9`, React Router `^7`. Do not upgrade these in this milestone.
- **Names:** database columns, API fields and shared types are snake_case and match the spec's column names exactly.
- **Time:** timestamps are UTC ISO-8601 strings (`Date.prototype.toISOString()`); `date` values are `YYYY-MM-DD` in the profile timezone (default `Europe/London`). The pod runs in UTC — never use the process timezone for a calendar date.
- **Claude:** model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`), effort from `ANTHROPIC_EFFORT` (default `medium`), every tool `strict: true`, `tool_choice` left at auto, `fallbacks: "default"`, conversation history append-only.
- **Auth fails closed:** every `/api/*` route except `/api/health` needs a valid Cloudflare Access JWT whose `email` equals `OWNER_EMAIL`; any failure is a bodiless 401.
- **Privacy:** never log message text or health values; never commit real health data or a plaintext secret (the repository is public).
- **Deployment shape:** 1 replica, `strategy: Recreate`, `ReadWriteOnce` PVC on `ssd`, memory limit 384 Mi, metrics on port 9464 with no Ingress route.
- **SQLite settings:** `journal_mode=DELETE`, `synchronous=FULL`, `locking_mode=EXCLUSIVE`, `foreign_keys=ON`, `temp_store=MEMORY`, one connection.
- **Commits:** one commit per task at the end of the task (the commit step shows the message); follow the session's commit-attribution rules.

## Scope

**In:** everything in spec §17 item 1 — scaffolding; schema and migrations; profile, targets and the day lifecycle; the coach with `log_items` and `update_entry` (text only) with food items carrying the extra nutrients and food groups; manual add, edit and Undo; the Today screen with day navigation; Access verification; CI/CD; `k8s/`; the first home-cluster pull request; database snapshots; the iPhone test.

**Deliberately later** (and the milestone that brings each): drafts and advice context, photos, measurements, `get_*` tools, the AI call cap and `ai_usage` table, goals, habits and check-ins (M2); Apple Health ingest, Trends, Body page (M3); offline outbox, saved foods (M4); Playwright smoke tests (M2, once the coach UI is richer).

**Milestone-1 coach:** text only; tools `log_items` and `update_entry`; its context is a frozen system prompt (instructions + profile) plus a per-turn JSON block with the time, today's targets, totals and entries. For questions it answers briefly with no draft card.

**One refinement of the spec, on purpose:** §6.3 says each tool runs in its own transaction. Here, everything a coach message writes — entries, conversation turns, the reply — commits together in **one** transaction after the tool loop succeeds. A failed message therefore leaves nothing behind, and Retry can never log the same meal twice.

**Steps marked OWNER** need the human owner (credentials, Cloudflare, the iPhone). Stop and ask; never handle their API keys or passwords yourself.

**Dry-run verified (2026-10-03):** every file in this plan was assembled in a scratch copy with the pinned versions; `typecheck`, `lint`, all 150 tests (shared 14, server 115, web 21), the PWA build, a production boot and the CI manifest assertions passed. The container image itself was not built in that dry run (the machine's Docker daemon could not reach Docker Hub); the CI `image` job (Task 25) is its first real test. If a step fails for you, suspect a newer package release first — install the exact versions named here.

## File map

```
package.json, package-lock.json, .nvmrc, .gitignore, .dockerignore, .sops.yaml
tsconfig.base.json, eslint.config.js, Dockerfile, README.md
shared/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts        re-exports everything below
  src/vocab.ts        fixed vocabularies (muscles, food groups, …) and small constants
  src/dates.ts        YYYY-MM-DD arithmetic
  src/schemas.ts      Zod request schemas (profile, entries, messages)
  src/api.ts          response types (DayView, Entry, ChatMessage, …)
  test/*.test.ts
server/
  package.json, tsconfig.json, vitest.config.ts, drizzle.config.ts
  drizzle/            generated SQL migrations (drizzle-kit)
  src/main.ts         process entry: config, database, jobs, listen
  src/app.ts          buildApp(): Fastify instance, auth hook, static PWA
  src/deps.ts         AppDeps — everything routes need
  src/config.ts       environment → Config
  src/time.ts         timezone helpers (Intl only)
  src/shared.ts       re-export of ../../shared/src
  src/metrics.ts      Prometheus registry and :9464 server
  src/jobs.ts         nightly snapshot
  src/db/             schema.ts, types.ts (Sql), open.ts, snapshot.ts
  src/targets/        targets.ts (pure maths)
  src/auth/           access.ts (Cloudflare Access JWT)
  src/profile/        profile.ts
  src/log/            entries.ts (persistence), convert.ts (API input → rows)
  src/days/           days.ts (snapshots, DayView)
  src/messages/       messages.ts
  src/ai/             client.ts (interface), anthropic.ts (real client)
  src/coach/          tools.ts, staging.ts, prompt.ts, thread.ts, loop.ts, process.ts
  src/routes/         index.ts, http.ts, health.ts, profile.ts, days.ts, entries.ts, messages.ts
  test/               helpers.ts, fake-ai.ts, *.test.ts
web/
  package.json, tsconfig.json, vite.config.ts, index.html
  public/             logo.svg + generated PWA icons
  src/main.tsx, App.tsx, index.css, api.ts, session.tsx, queries.ts, format.ts, shared.ts
  src/components/     DayNav, Summary, Feed, EntryCard, EntryEditor, Composer, SignedOutBanner, SetupPrompt, TabBar
  src/pages/          TodayPage.tsx, SettingsPage.tsx
  src/test/           setup.ts, render.tsx, fixtures.ts
k8s/                  00-namespace, 10-pvc, 30-app, 50-ingress, 60-rate-limits, 80-secrets.sops, kustomization
.github/workflows/    verify.yaml, ci.yaml
```

---

### Task 1: Monorepo scaffold, shared vocabularies and date helpers

**Files:**
- Create: `package.json`, `.nvmrc`, `.gitignore`, `tsconfig.base.json`, `eslint.config.js`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`
- Create: `shared/src/vocab.ts`, `shared/src/dates.ts`, `shared/src/index.ts`
- Test: `shared/test/dates.test.ts`

**Interfaces:**
- Produces (`shared/src/vocab.ts`): `MUSCLES`, `Muscle`, `MUSCLE_ROLES`, `MuscleRole`, `FOOD_GROUPS`, `FoodGroup`, `EXERCISE_CATEGORIES`, `ExerciseCategory`, `ACTIVITY_LEVEL_KEYS`, `ActivityLevel`, `ACTIVITY_FACTORS: Record<ActivityLevel, number>`, `BODY_GOALS`, `BodyGoal`, `SEXES`, `Sex`, `ENTRY_SOURCES`, `EntrySource`, `MAX_BACKDATE_DAYS = 7`.
- Produces (`shared/src/dates.ts`): `isIsoDate(value: string): boolean`, `addDays(date: string, days: number): string`, `daysBetween(from: string, to: string): number` (`to − from` in whole days).

- [ ] **Step 1: Branch**

The repository has no commits on `main`; the design spec lives on `docs/fitnessai-design`. Build on top of it:

```bash
git switch docs/fitnessai-design
git switch -c m1-foundation
```

- [ ] **Step 2: Root files**

`package.json`:

```json
{
  "name": "fitnessai",
  "private": true,
  "type": "module",
  "workspaces": ["shared"],
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "tsc -p shared",
    "lint": "eslint .",
    "test": "npm run test --workspaces --if-present"
  }
}
```

`.nvmrc`:

```
24
```

`.gitignore`:

```
node_modules/
dist/
dev-dist/
coverage/
.data/
*.log
.env
.DS_Store
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`eslint.config.js`:

```js
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/", "**/dist/", "**/dev-dist/", "server/drizzle/", ".data/"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A leading underscore marks a deliberately unused binding (e.g. a rest-sibling).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);
```

- [ ] **Step 3: The shared workspace**

`shared/package.json`:

```json
{
  "name": "@fitnessai/shared",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`shared/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

Install the tooling (from the repository root):

```bash
npm install -D typescript@~6.0.3 eslint@^9 @eslint/js@^9 typescript-eslint@^8 globals@^17 @types/node@^24
npm install -w shared zod@^4.6.5
npm install -w shared -D vitest@^5.0.3
```

Expected: `package-lock.json` is created and `node_modules/` is populated with no errors.

- [ ] **Step 4: Write the failing test**

`shared/test/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isIsoDate } from "../src/dates.ts";

describe("isIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isIsoDate("2026-10-03")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-01", "03/10/2026", "", "2026-10-03T00:00"]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-03", -7)).toBe("2026-09-26");
  });

  it("refuses something that is not a date", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("daysBetween", () => {
  it("counts whole days from the first date to the second", () => {
    expect(daysBetween("2026-10-01", "2026-10-03")).toBe(2);
    expect(daysBetween("2026-10-03", "2026-10-01")).toBe(-2);
    // Across the March clock change: calendar days, not 24-hour periods.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npm test`
Expected: FAIL — `Failed to load url ../src/dates.ts` (the module does not exist yet).

- [ ] **Step 6: Implement**

`shared/src/dates.ts`:

```ts
// Calendar dates are plain YYYY-MM-DD strings. The arithmetic runs in UTC so a
// clock change can never make a "day" 23 or 25 hours long.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function utcMidnight(date: string): number {
  if (!isIsoDate(date)) throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}
```

`shared/src/vocab.ts`:

```ts
// Fixed vocabularies (spec §5.1). They are enums in the coach's tool schemas, so
// Claude can only choose from them and charts never split across synonyms.

export const MUSCLES = [
  "chest", "upper_back", "lats", "shoulders", "biceps", "triceps",
  "forearms", "core", "glutes", "quads", "hamstrings", "calves",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_ROLES = ["primary", "secondary"] as const;
export type MuscleRole = (typeof MUSCLE_ROLES)[number];

export const FOOD_GROUPS = [
  "vegetables", "fruit", "legumes", "wholegrains", "nuts_seeds", "oily_fish",
  "red_meat", "processed_meat", "ultra_processed", "sugary_drinks", "fried_food",
] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export const EXERCISE_CATEGORIES = ["strength", "cardio", "mobility", "sport"] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

/** Day-to-day activity EXCLUDING workouts — workouts are added back separately (spec §7.1). */
export const ACTIVITY_LEVEL_KEYS = ["sedentary", "light", "moderate", "very"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVEL_KEYS)[number];
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
};

export const BODY_GOALS = ["lose", "maintain", "gain"] as const;
export type BodyGoal = (typeof BODY_GOALS)[number];

export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

export const ENTRY_SOURCES = ["coach", "photo", "saved_food", "manual", "apple_health"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/** How far back the coach may log or change things (spec §7.5). */
export const MAX_BACKDATE_DAYS = 7;
```

`shared/src/index.ts`:

```ts
export * from "./vocab.ts";
export * from "./dates.ts";
```

- [ ] **Step 7: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: `Tests  5 passed`; `tsc` and `eslint` print nothing and exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .nvmrc .gitignore tsconfig.base.json eslint.config.js shared
git commit -m "chore: scaffold the monorepo with shared vocabularies and date helpers"
```

---

### Task 2: Shared request schemas and response types

**Files:**
- Create: `shared/src/schemas.ts`, `shared/src/api.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/schemas.test.ts`

**Interfaces:**
- Consumes: `shared/src/vocab.ts`, `shared/src/dates.ts` (Task 1).
- Produces (`schemas.ts`, each a Zod schema **and** a same-named type of its parsed output): `FoodItemInput`, `ExerciseItemInput`, `ManualEntryInput` (`{ id, date, time: "HH:MM" | null, foods, exercises }`), `EntryPatch` (`{ foods, exercises }`), `ProfileInput` (type = what a client sends), `Profile` (type only = parsed profile with defaults), `MessageInput` (`{ id, sent_at, text }`); plus `IsoDate`, `TIME_HHMM: RegExp`, `isTimeZone(value: string): boolean`.
- Produces (`api.ts`, types only): `MacroTargets`, `Totals`, `FoodItem`, `ExerciseItem`, `Entry`, `DayTargets`, `MessageRole`, `MessageStatus`, `Card`, `ChatMessage`, `DayView`, `ProfileView`, `EntryResult`, `DeleteResult`, `MessageResult`, `ApiErrorBody`.

- [ ] **Step 1: Write the failing test**

`shared/test/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EntryPatch, ExerciseItemInput, FoodItemInput, ManualEntryInput, MessageInput, ProfileInput, isTimeZone,
} from "../src/schemas.ts";

const UUID = "0b9c7f4e-6a51-4f5e-9d4c-2f1f8f6f1a10";
const food = { name: "Porridge", kcal: 300, protein_g: 10, carbs_g: 50, fat_g: 6 };

describe("FoodItemInput", () => {
  it("fills the optional nutrients and groups with defaults", () => {
    expect(FoodItemInput.parse(food)).toMatchObject({
      quantity: "", grams: null, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0,
      fluid_ml: 0, alcohol_units: 0, assumption: "", groups: [],
    });
  });

  it("rejects negative amounts and unknown food groups", () => {
    expect(FoodItemInput.safeParse({ ...food, kcal: -1 }).success).toBe(false);
    expect(FoodItemInput.safeParse({ ...food, groups: [{ group: "candy", portions: 1 }] }).success).toBe(false);
  });
});

describe("ExerciseItemInput", () => {
  it("accepts a MET-based item and defaults the rest to null", () => {
    const item = ExerciseItemInput.parse({ name: "Run", category: "cardio", duration_min: 30, met: 9 });
    expect(item).toMatchObject({ kcal: null, sets: null, reps: null, muscles: [], assumption: "" });
  });

  it("rejects muscles outside the fixed list", () => {
    const curl = { name: "Curl", category: "strength", muscles: [{ muscle: "pecs", role: "primary" }] };
    expect(ExerciseItemInput.safeParse(curl).success).toBe(false);
  });
});

describe("ManualEntryInput and EntryPatch", () => {
  it("require at least one item", () => {
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03" }).success).toBe(false);
    expect(EntryPatch.safeParse({ foods: [], exercises: [] }).success).toBe(false);
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03", foods: [food] }).success).toBe(true);
  });

  it("validate the time as HH:MM and the date as a real date", () => {
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03", time: "7:30", foods: [food] }).success).toBe(false);
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-10-03", time: "07:30", foods: [food] }).success).toBe(true);
    expect(ManualEntryInput.safeParse({ id: UUID, date: "2026-02-30", foods: [food] }).success).toBe(false);
  });
});

describe("ProfileInput", () => {
  const minimal = {
    sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60,
    activity_level: "light", goal: "maintain", goal_rate_kg_week: 0,
  };

  it("applies the spec's defaults", () => {
    expect(ProfileInput.parse(minimal)).toMatchObject({
      protein_g_per_kg: 1.8, fat_pct: 30, fibre_g: 30, add_back_pct: 50, timezone: "Europe/London",
      body_goal_priority: "high", context_days: 5, goal_notes: "on", units_mass: "kg", units_length: "cm",
      override_kcal: null, override_protein_g: null, override_carbs_g: null, override_fat_g: null, override_fibre_g: null,
    });
  });

  it("rejects an unknown timezone", () => {
    expect(ProfileInput.safeParse({ ...minimal, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(isTimeZone("Europe/London")).toBe(true);
  });
});

describe("MessageInput", () => {
  it("needs a UUID, a UTC timestamp and non-empty text", () => {
    const ok = { id: UUID, sent_at: "2026-10-03T12:00:00.000Z", text: "2 eggs" };
    expect(MessageInput.safeParse(ok).success).toBe(true);
    expect(MessageInput.safeParse({ ...ok, id: "abc" }).success).toBe(false);
    expect(MessageInput.safeParse({ ...ok, sent_at: "2026-10-03 12:00" }).success).toBe(false);
    expect(MessageInput.safeParse({ ...ok, text: "   " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL — `Failed to load url ../src/schemas.ts`.

- [ ] **Step 3: Implement**

`shared/src/schemas.ts`:

```ts
import { z } from "zod";
import { isIsoDate } from "./dates.ts";
import {
  ACTIVITY_LEVEL_KEYS, BODY_GOALS, EXERCISE_CATEGORIES, FOOD_GROUPS, MUSCLES, MUSCLE_ROLES, SEXES,
} from "./vocab.ts";

// Request bodies the API accepts. Each schema's parsed output (defaults filled in)
// is exported as a type of the same name.

export const IsoDate = z.string().refine(isIsoDate, { message: "Expected a date as YYYY-MM-DD" });
export const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const amount = z.number().nonnegative();
const optionalPositive = z.number().positive().nullable().default(null);

export const FoodGroupPortion = z.object({ group: z.enum(FOOD_GROUPS), portions: z.number().positive() });
export const MuscleWork = z.object({ muscle: z.enum(MUSCLES), role: z.enum(MUSCLE_ROLES) });

export const FoodItemInput = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(200).default(""),
  grams: z.number().positive().nullable().default(null),
  kcal: amount,
  protein_g: amount,
  carbs_g: amount,
  fat_g: amount,
  fibre_g: amount.default(0),
  saturated_fat_g: amount.default(0),
  sugars_g: amount.default(0),
  salt_g: amount.default(0),
  fluid_ml: amount.default(0),
  alcohol_units: amount.default(0),
  assumption: z.string().max(500).default(""),
  groups: z.array(FoodGroupPortion).max(FOOD_GROUPS.length).default([]),
});
export type FoodItemInput = z.infer<typeof FoodItemInput>;

export const ExerciseItemInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(EXERCISE_CATEGORIES),
  duration_min: optionalPositive,
  sets: optionalPositive,
  reps: optionalPositive,
  weight_kg: optionalPositive,
  distance_km: optionalPositive,
  avg_hr: optionalPositive,
  met: z.number().min(1).max(25).nullable().default(null),
  /** Active kcal. When null, the server derives it from `met` and `duration_min`. */
  kcal: amount.nullable().default(null),
  assumption: z.string().max(500).default(""),
  muscles: z.array(MuscleWork).max(MUSCLES.length * 2).default([]),
});
export type ExerciseItemInput = z.infer<typeof ExerciseItemInput>;

const items = {
  foods: z.array(FoodItemInput).max(30).default([]),
  exercises: z.array(ExerciseItemInput).max(30).default([]),
};
const hasItems = (value: { foods: unknown[]; exercises: unknown[] }) => value.foods.length + value.exercises.length > 0;
const NEEDS_ITEMS = { message: "An entry needs at least one item" };

export const ManualEntryInput = z
  .object({
    id: z.uuid(),
    date: IsoDate,
    time: z.string().regex(TIME_HHMM).nullable().default(null),
    ...items,
  })
  .refine(hasItems, NEEDS_ITEMS);
export type ManualEntryInput = z.infer<typeof ManualEntryInput>;

export const EntryPatch = z.object(items).refine(hasItems, NEEDS_ITEMS);
export type EntryPatch = z.infer<typeof EntryPatch>;

const override = z.number().nonnegative().nullable().default(null);

export const ProfileInput = z.object({
  sex: z.enum(SEXES),
  birth_date: IsoDate,
  height_cm: z.number().min(100).max(250),
  weight_kg: z.number().min(30).max(300),
  activity_level: z.enum(ACTIVITY_LEVEL_KEYS),
  goal: z.enum(BODY_GOALS),
  goal_rate_kg_week: z.number().min(0).max(1),
  body_goal_priority: z.enum(["high", "normal"]).default("high"),
  protein_g_per_kg: z.number().min(0.5).max(3.5).default(1.8),
  fat_pct: z.number().min(15).max(50).default(30),
  fibre_g: z.number().min(0).max(80).default(30),
  add_back_pct: z.number().min(0).max(100).default(50),
  override_kcal: override,
  override_protein_g: override,
  override_carbs_g: override,
  override_fat_g: override,
  override_fibre_g: override,
  timezone: z.string().refine(isTimeZone, { message: "Unknown timezone" }).default("Europe/London"),
  units_mass: z.enum(["kg", "st_lb"]).default("kg"),
  units_length: z.enum(["cm", "in"]).default("cm"),
  context_days: z.number().int().min(1).max(14).default(5),
  goal_notes: z.enum(["on", "off"]).default("on"),
});
/** What a client sends: fields with defaults may be omitted. */
export type ProfileInput = z.input<typeof ProfileInput>;
/** A stored profile, every field present. */
export type Profile = z.output<typeof ProfileInput>;

export const MessageInput = z.object({
  id: z.uuid(),
  sent_at: z.iso.datetime(),
  text: z.string().trim().min(1).max(4000),
});
export type MessageInput = z.infer<typeof MessageInput>;
```

`shared/src/api.ts`:

```ts
import type { ExerciseCategory, EntrySource, FoodGroup, Muscle, MuscleRole } from "./vocab.ts";
import type { Profile } from "./schemas.ts";

// Shapes the API returns. The server builds them; the web app renders them.

export interface MacroTargets {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

export interface Totals extends MacroTargets {
  saturated_fat_g: number;
  sugars_g: number;
  salt_g: number;
  fluid_ml: number;
  alcohol_units: number;
}

export interface FoodItem extends Totals {
  id: string;
  position: number;
  name: string;
  quantity: string;
  grams: number | null;
  assumption: string;
  saved_food_id: string | null;
  groups: { group: FoodGroup; portions: number }[];
}

export interface ExerciseItem {
  id: string;
  position: number;
  name: string;
  category: ExerciseCategory;
  duration_min: number | null;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  distance_km: number | null;
  avg_hr: number | null;
  met: number | null;
  /** Active kcal (spec §7.3). */
  kcal: number;
  kcal_measured: boolean;
  assumption: string;
  muscles: { muscle: Muscle; role: MuscleRole }[];
}

export interface Entry {
  id: string;
  date: string;
  logged_at: string;
  source: EntrySource;
  message_id: string | null;
  edited: boolean;
  foods: FoodItem[];
  exercises: ExerciseItem[];
}

export interface DayTargets {
  base: MacroTargets;
  adjusted: MacroTargets;
  add_back_kcal: number;
  workout_kcal: number;
}

export type MessageRole = "user" | "assistant" | "note";
export type MessageStatus = "pending" | "done" | "failed";
export interface Card {
  type: "entry";
  id: string;
}

export interface ChatMessage {
  id: string;
  date: string;
  role: MessageRole;
  text: string;
  /** User messages only. */
  status: MessageStatus | null;
  error_code: string | null;
  cards: Card[];
  /** On a reply: the user message it answers. */
  reply_to: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface DayView {
  date: string;
  /** Today's date in the profile timezone, so the client never guesses. */
  today: string;
  targets: DayTargets;
  totals: Totals;
  entries: Entry[];
  messages: ChatMessage[];
}

export interface ProfileView {
  profile: Profile;
  /** Baseline targets before overrides, for showing beside the override fields. */
  calculated: MacroTargets;
}

export interface EntryResult {
  entry: Entry;
  day: DayView;
}

export interface DeleteResult {
  day: DayView;
}

export interface MessageResult {
  user: ChatMessage;
  reply: ChatMessage | null;
  day: DayView;
}

export interface ApiErrorBody {
  error: string;
  issues?: { path: string; message: string }[];
}
```

Replace `shared/src/index.ts` with:

```ts
export * from "./vocab.ts";
export * from "./dates.ts";
export * from "./schemas.ts";
export * from "./api.ts";
```

- [ ] **Step 4: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: `Tests  14 passed` (5 from Task 1 + 9 new); no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): request schemas and response types"
```

---

### Task 3: Server workspace and the targets engine

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/shared.ts`
- Create: `server/src/targets/targets.ts`
- Create: `server/test/helpers.ts`
- Modify: `package.json` (workspaces, typecheck)
- Test: `server/test/targets.test.ts`

**Interfaces:**
- Consumes: `ACTIVITY_FACTORS`, `Profile`, `MacroTargets`, `ProfileInput` from shared (Tasks 1–2).
- Produces (`server/src/targets/targets.ts`, all pure):
  - `ageOn(birthDate: string, date: string): number`
  - `bmr(sex: Profile["sex"], weightKg: number, heightCm: number, age: number): number`
  - `goalDelta(goal: Profile["goal"], rateKgWeek: number): number`
  - `baselineTargets(profile: Profile, weightKg: number, date: string, useOverrides = true): MacroTargets`
  - `interface WorkoutSummary { workoutKcal: number; strengthDay: boolean }`
  - `interface AdjustedTargets { base: MacroTargets; adjusted: MacroTargets; addBackKcal: number; workoutKcal: number }`
  - `adjustTargets(base: MacroTargets, addBackPct: number, weightKg: number, workout: WorkoutSummary): AdjustedTargets`
  - `exerciseKcal(met: number, weightKg: number, minutes: number): number` — `(MET − 1) × kg × hours`, never negative.
- Produces (`server/test/helpers.ts`): `makeProfile(overrides?: Partial<ProfileInput>): Profile` (male, born 1991-03-15, 180 cm, 80 kg, light, lose 0.5 kg/week).

- [ ] **Step 1: Create the workspace**

`server/package.json`:

```json
{
  "name": "@fitnessai/server",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "../shared/src", "*.ts"]
}
```

`server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// `forks` keeps the native better-sqlite3 module out of worker threads.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], pool: "forks" } });
```

`server/src/shared.ts`:

```ts
// The one import point for code shared with the web app. The server runs
// TypeScript with Node's type stripping, which does not apply inside
// node_modules, so shared code is imported by relative path, not as a package.
export * from "../../shared/src/index.ts";
```

In the root `package.json`, change `"workspaces"` and `"typecheck"`:

```json
  "workspaces": ["shared", "server"],
```

```json
    "typecheck": "tsc -p shared && tsc -p server",
```

Then:

```bash
npm install -w server -D vitest@^5.0.3
```

- [ ] **Step 2: Write the test helper and the failing test**

`server/test/helpers.ts`:

```ts
import { ProfileInput } from "../src/shared.ts";
import type { Profile } from "../src/shared.ts";

/** A complete profile: male, 35 on 2026-10-03, 180 cm, 80 kg, light activity, losing 0.5 kg a week. */
export function makeProfile(overrides: Partial<ProfileInput> = {}): Profile {
  return ProfileInput.parse({
    sex: "male",
    birth_date: "1991-03-15",
    height_cm: 180,
    weight_kg: 80,
    activity_level: "light",
    goal: "lose",
    goal_rate_kg_week: 0.5,
    ...overrides,
  });
}
```

`server/test/targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adjustTargets, ageOn, baselineTargets, bmr, exerciseKcal, goalDelta } from "../src/targets/targets.ts";
import { makeProfile } from "./helpers.ts";

const DATE = "2026-10-03";

describe("ageOn", () => {
  it("counts a birthday only once it has passed", () => {
    expect(ageOn("1991-03-15", DATE)).toBe(35);
    expect(ageOn("1991-10-04", DATE)).toBe(34);
    expect(ageOn("1991-10-03", DATE)).toBe(35);
  });
});

describe("bmr (Mifflin-St Jeor)", () => {
  it("uses +5 for men and −161 for women", () => {
    expect(bmr("male", 80, 180, 35)).toBe(1755);
    expect(bmr("female", 50, 160, 30)).toBe(1189);
  });
});

describe("goalDelta", () => {
  it("turns kg a week into daily kcal", () => {
    expect(goalDelta("lose", 0.5)).toBe(-550);
    expect(goalDelta("gain", 0.25)).toBe(275);
    expect(goalDelta("maintain", 0.5)).toBe(0);
  });
});

describe("baselineTargets", () => {
  it("matches a hand-worked example", () => {
    // BMR 1755 × 1.375 = 2413.125, minus 550 for losing 0.5 kg a week.
    const t = baselineTargets(makeProfile(), 80, DATE);
    expect(t.kcal).toBeCloseTo(1863.125, 6);
    expect(t.protein_g).toBeCloseTo(144, 6); // 1.8 g × 80 kg
    expect(t.fat_g).toBeCloseTo(62.1041667, 6); // 30 % of kcal ÷ 9
    expect(t.carbs_g).toBeCloseTo(182.046875, 6); // the remainder ÷ 4
    expect(t.fibre_g).toBe(30);
  });

  it("never goes below BMR", () => {
    const profile = makeProfile({
      sex: "female", birth_date: "1996-01-01", height_cm: 160, weight_kg: 50,
      activity_level: "sedentary", goal: "lose", goal_rate_kg_week: 1,
    });
    expect(baselineTargets(profile, 50, DATE).kcal).toBeCloseTo(1189, 6);
  });

  it("adds the surplus when gaining", () => {
    const profile = makeProfile({ goal: "gain", goal_rate_kg_week: 0.25 });
    expect(baselineTargets(profile, 80, DATE).kcal).toBeCloseTo(2688.125, 6);
  });

  it("lets fat follow an overridden kcal and keeps carbs as the remainder", () => {
    const t = baselineTargets(makeProfile({ override_kcal: 2000 }), 80, DATE);
    expect(t.kcal).toBe(2000);
    expect(t.fat_g).toBeCloseTo(66.6666667, 6);
    expect(t.carbs_g).toBeCloseTo(206, 6); // (2000 − 576 − 600) ÷ 4
  });

  it("uses an overridden carb target as given", () => {
    expect(baselineTargets(makeProfile({ override_carbs_g: 150 }), 80, DATE).carbs_g).toBe(150);
  });

  it("can ignore overrides, for showing the calculated values", () => {
    const t = baselineTargets(makeProfile({ override_kcal: 2000 }), 80, DATE, false);
    expect(t.kcal).toBeCloseTo(1863.125, 6);
  });
});

describe("adjustTargets", () => {
  const base = { kcal: 2000, protein_g: 144, carbs_g: 200, fat_g: 66, fibre_g: 30 };

  it("changes nothing without a workout", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 0, strengthDay: false });
    expect(t.adjusted).toEqual(base);
    expect(t.addBackKcal).toBe(0);
  });

  it("splits a cardio add-back 75 % carbs, 25 % fat", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 400, strengthDay: false });
    expect(t.addBackKcal).toBe(200);
    expect(t.adjusted.kcal).toBe(2200);
    expect(t.adjusted.protein_g).toBe(144);
    expect(t.adjusted.carbs_g).toBeCloseTo(237.5, 6); // + 150 kcal ÷ 4
    expect(t.adjusted.fat_g).toBeCloseTo(71.5555556, 6); // + 50 kcal ÷ 9
    expect(t.adjusted.fibre_g).toBe(30);
  });

  it("pays for strength-day protein out of the add-back", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 400, strengthDay: true });
    expect(t.adjusted.protein_g).toBeCloseTo(160, 6); // + 0.2 g × 80 kg
    expect(t.adjusted.carbs_g).toBeCloseTo(225.5, 6); // + 0.75 × 136 ÷ 4
    expect(t.adjusted.fat_g).toBeCloseTo(69.7777778, 6); // + 0.25 × 136 ÷ 9
    expect(t.adjusted.kcal).toBe(2200);
  });

  it("never lets the protein increase exceed the add-back", () => {
    const t = adjustTargets(base, 50, 80, { workoutKcal: 40, strengthDay: true });
    expect(t.adjusted.protein_g).toBeCloseTo(149, 6); // add-back 20 kcal → 5 g
    expect(t.adjusted.carbs_g).toBe(200);
    expect(t.adjusted.fat_g).toBe(66);
  });
});

describe("exerciseKcal", () => {
  it("counts active calories only: (MET − 1) × kg × hours", () => {
    expect(exerciseKcal(8, 80, 30)).toBe(280);
    expect(exerciseKcal(1, 80, 60)).toBe(0);
    expect(exerciseKcal(0.5, 80, 60)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/targets/targets.ts`.

- [ ] **Step 4: Implement**

`server/src/targets/targets.ts`:

```ts
import { ACTIVITY_FACTORS } from "../shared.ts";
import type { MacroTargets, Profile } from "../shared.ts";

// Pure target maths (spec §7). No I/O: everything comes in as arguments.

const KCAL_PER_KG = 7700;

export function ageOn(birthDate: string, date: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  const birthdayPassed = month > birthMonth || (month === birthMonth && day >= birthDay);
  return year - birthYear - (birthdayPassed ? 0 : 1);
}

/** Mifflin-St Jeor resting energy, kcal/day. */
export function bmr(sex: Profile["sex"], weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

/** Daily kcal change for the body goal: rate × 7700 ÷ 7. */
export function goalDelta(goal: Profile["goal"], rateKgWeek: number): number {
  if (goal === "maintain") return 0;
  const daily = (rateKgWeek * KCAL_PER_KG) / 7;
  return goal === "lose" ? -daily : daily;
}

const NO_OVERRIDES = {
  override_kcal: null,
  override_protein_g: null,
  override_carbs_g: null,
  override_fat_g: null,
  override_fibre_g: null,
} as const;

export function baselineTargets(profile: Profile, weightKg: number, date: string, useOverrides = true): MacroTargets {
  const floor = bmr(profile.sex, weightKg, profile.height_cm, ageOn(profile.birth_date, date));
  const maintenance = floor * ACTIVITY_FACTORS[profile.activity_level];
  const calculatedKcal = Math.max(floor, maintenance + goalDelta(profile.goal, profile.goal_rate_kg_week));
  const o = useOverrides ? profile : NO_OVERRIDES;

  const kcal = o.override_kcal ?? calculatedKcal;
  const protein_g = o.override_protein_g ?? profile.protein_g_per_kg * weightKg;
  const fat_g = o.override_fat_g ?? (profile.fat_pct / 100) * kcal / 9;
  const carbs_g = o.override_carbs_g ?? Math.max(0, (kcal - 4 * protein_g - 9 * fat_g) / 4);
  const fibre_g = o.override_fibre_g ?? profile.fibre_g;
  return { kcal, protein_g, carbs_g, fat_g, fibre_g };
}

export interface WorkoutSummary {
  /** Active kcal of the day's workouts. */
  workoutKcal: number;
  strengthDay: boolean;
}

export interface AdjustedTargets {
  base: MacroTargets;
  adjusted: MacroTargets;
  addBackKcal: number;
  workoutKcal: number;
}

/** Adds part of the workout calories back to the day's budget (spec §7.2). */
export function adjustTargets(base: MacroTargets, addBackPct: number, weightKg: number, workout: WorkoutSummary): AdjustedTargets {
  const addBack = (addBackPct / 100) * workout.workoutKcal;
  const proteinExtra = workout.strengthDay ? Math.min(0.2 * weightKg, addBack / 4) : 0;
  const rest = addBack - 4 * proteinExtra;
  return {
    base,
    adjusted: {
      kcal: base.kcal + addBack,
      protein_g: base.protein_g + proteinExtra,
      carbs_g: base.carbs_g + (0.75 * rest) / 4,
      fat_g: base.fat_g + (0.25 * rest) / 9,
      fibre_g: base.fibre_g,
    },
    addBackKcal: addBack,
    workoutKcal: workout.workoutKcal,
  };
}

/** Active kcal for an activity: resting burn is already in BMR, so subtract one MET. */
export function exerciseKcal(met: number, weightKg: number, minutes: number): number {
  return Math.max(0, (met - 1) * weightKg * (minutes / 60));
}
```

- [ ] **Step 5: Run the tests, type-check and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: shared and server suites pass (`targets.test.ts`: 14 tests); no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server
git commit -m "feat(server): targets engine"
```

---

### Task 4: Timezone helpers

**Files:**
- Create: `server/src/time.ts`
- Test: `server/test/time.test.ts`

**Interfaces:**
- Produces: `localDate(instant: Date, timeZone: string): string` (YYYY-MM-DD), `localTime(instant: Date, timeZone: string): string` (HH:MM, 24-hour), `weekdayName(instant: Date, timeZone: string): string` (e.g. `"Saturday"`), `todayIn(timeZone: string, now: Date): string`, `zonedTimeToInstant(date: string, time: string, timeZone: string): Date`.

- [ ] **Step 1: Write the failing test**

`server/test/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localDate, localTime, todayIn, weekdayName, zonedTimeToInstant } from "../src/time.ts";

const LONDON = "Europe/London";
const at = (iso: string) => new Date(iso);

describe("localDate", () => {
  it("uses the wall clock of the timezone, not UTC", () => {
    expect(localDate(at("2026-03-28T23:30:00Z"), LONDON)).toBe("2026-03-28"); // GMT
    expect(localDate(at("2026-06-30T23:30:00Z"), LONDON)).toBe("2026-07-01"); // BST: already 00:30
    expect(localDate(at("2026-10-24T23:30:00Z"), LONDON)).toBe("2026-10-25"); // still BST
    expect(localDate(at("2026-10-25T23:30:00Z"), LONDON)).toBe("2026-10-25"); // back on GMT
  });
});

describe("localTime and weekdayName", () => {
  it("format the local wall clock", () => {
    expect(localTime(at("2026-07-01T07:10:00Z"), LONDON)).toBe("08:10");
    expect(localTime(at("2026-06-30T23:05:00Z"), LONDON)).toBe("00:05");
    expect(weekdayName(at("2026-10-03T12:00:00Z"), LONDON)).toBe("Saturday");
    expect(todayIn(LONDON, at("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("zonedTimeToInstant", () => {
  it("finds the UTC instant for a local date and time", () => {
    expect(zonedTimeToInstant("2026-07-01", "08:10", LONDON).toISOString()).toBe("2026-07-01T07:10:00.000Z");
    expect(zonedTimeToInstant("2026-12-01", "08:10", LONDON).toISOString()).toBe("2026-12-01T08:10:00.000Z");
    expect(zonedTimeToInstant("2026-07-01", "08:10", "America/New_York").toISOString()).toBe("2026-07-01T12:10:00.000Z");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/time.ts`.

- [ ] **Step 3: Implement**

`server/src/time.ts`:

```ts
// Timezone helpers built on Intl only. The pod runs in UTC; every calendar date
// in the app is computed in the profile's timezone through these functions.

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDate(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localTime(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function weekdayName(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(instant);
}

export function todayIn(timeZone: string, now: Date): string {
  return localDate(now, timeZone);
}

/** Minutes the timezone is ahead of UTC at `instant` (BST → 60). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant at which the clock in `timeZone` reads `date` `time` (HH:MM). */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset even when the guess lands on the other side of a clock change.
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `time.test.ts` 3 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/time.ts server/test/time.test.ts
git commit -m "feat(server): timezone helpers"
```

---

### Task 5: Database schema, migrations, opening and snapshots

**Files:**
- Create: `server/drizzle.config.ts`, `server/src/db/schema.ts`, `server/src/db/types.ts`, `server/src/db/open.ts`, `server/src/db/snapshot.ts`
- Generate: `server/drizzle/0000_*.sql` and `server/drizzle/meta/*`
- Modify: `server/package.json` (dependencies, `db:generate` script), root `package.json` (`db:generate`), `server/test/helpers.ts`
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces (`schema.ts`): Drizzle tables `profile`, `days`, `entries`, `foodItems`, `foodItemGroups`, `exerciseItems`, `exerciseMuscles`, `messages`, `coachThreads`, `coachTurns` (SQL names as in spec §5).
- Produces (`types.ts`): `type Sql = BaseSQLiteDatabase<"sync", Database.RunResult>` — the database **or** a transaction; every data function takes a `Sql`.
- Produces (`open.ts`): `openDatabase(opts: OpenOptions): { db: Sql; sqlite: Database.Database; close(): void }` with `interface OpenOptions { file: string; snapshotDir: string | null; lockWaitMs?: number; lockRetryMs?: number }`.
- Produces (`snapshot.ts`): `snapshot(sqlite, dir, name): string`, `pruneSnapshots(dir, prefix, keep): string[]` (returns removed names), `stamp(date: Date): string`.
- Produces (`helpers.ts`): `tempDir(): string`, `openTestDb()`.

- [ ] **Step 1: Dependencies and generator config**

```bash
npm install -w server drizzle-orm@^0.45.3 better-sqlite3@^13.0.3
npm install -w server -D drizzle-kit@^0.31.11 @types/better-sqlite3@^9
```

Add to the `scripts` in `server/package.json`:

```json
    "db:generate": "drizzle-kit generate"
```

Add to the `scripts` in the root `package.json`:

```json
    "db:generate": "npm run db:generate --workspace server"
```

`server/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({ dialect: "sqlite", schema: "./src/db/schema.ts", out: "./drizzle" });
```

- [ ] **Step 2: The schema**

`server/src/db/schema.ts`:

```ts
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Column names are snake_case and match the spec (§5) and the API, so rows map
// onto API objects without renaming. Keep this file free of app imports:
// drizzle-kit loads it on its own.

export const profile = sqliteTable("profile", {
  id: integer().primaryKey(),
  sex: text().notNull(),
  birth_date: text().notNull(),
  height_cm: real().notNull(),
  weight_kg: real().notNull(),
  activity_level: text().notNull(),
  goal: text().notNull(),
  goal_rate_kg_week: real().notNull(),
  body_goal_priority: text().notNull(),
  protein_g_per_kg: real().notNull(),
  fat_pct: real().notNull(),
  fibre_g: real().notNull(),
  add_back_pct: real().notNull(),
  override_kcal: real(),
  override_protein_g: real(),
  override_carbs_g: real(),
  override_fat_g: real(),
  override_fibre_g: real(),
  timezone: text().notNull(),
  units_mass: text().notNull(),
  units_length: text().notNull(),
  context_days: integer().notNull(),
  goal_notes: text().notNull(),
  updated_at: text().notNull(),
});

export const days = sqliteTable("days", {
  date: text().primaryKey(),
  base_kcal: real().notNull(),
  base_protein_g: real().notNull(),
  base_carbs_g: real().notNull(),
  base_fat_g: real().notNull(),
  base_fibre_g: real().notNull(),
  add_back_pct: real().notNull(),
  weight_kg_used: real().notNull(),
  created_at: text().notNull(),
  updated_at: text().notNull(),
});

export const entries = sqliteTable(
  "entries",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    logged_at: text().notNull(),
    source: text().notNull(),
    message_id: text(),
    external_id: text().unique(),
    merged_into_entry_id: text(),
    edited: integer({ mode: "boolean" }).notNull().default(false),
    deleted_at: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index("entries_date_idx").on(t.date)],
);

export const foodItems = sqliteTable(
  "food_items",
  {
    id: text().primaryKey(),
    entry_id: text().notNull().references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    quantity: text().notNull(),
    grams: real(),
    kcal: real().notNull(),
    protein_g: real().notNull(),
    carbs_g: real().notNull(),
    fat_g: real().notNull(),
    fibre_g: real().notNull(),
    saturated_fat_g: real().notNull(),
    sugars_g: real().notNull(),
    salt_g: real().notNull(),
    fluid_ml: real().notNull(),
    alcohol_units: real().notNull(),
    assumption: text().notNull(),
    saved_food_id: text(),
  },
  (t) => [index("food_items_entry_idx").on(t.entry_id)],
);

export const foodItemGroups = sqliteTable(
  "food_item_groups",
  {
    food_item_id: text().notNull().references(() => foodItems.id, { onDelete: "cascade" }),
    food_group: text().notNull(),
    portions: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.food_item_id, t.food_group] })],
);

export const exerciseItems = sqliteTable(
  "exercise_items",
  {
    id: text().primaryKey(),
    entry_id: text().notNull().references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    category: text().notNull(),
    duration_min: real(),
    sets: real(),
    reps: real(),
    weight_kg: real(),
    distance_km: real(),
    avg_hr: real(),
    met: real(),
    kcal: real().notNull(),
    kcal_measured: integer({ mode: "boolean" }).notNull().default(false),
    assumption: text().notNull(),
  },
  (t) => [index("exercise_items_entry_idx").on(t.entry_id)],
);

export const exerciseMuscles = sqliteTable(
  "exercise_muscles",
  {
    exercise_item_id: text().notNull().references(() => exerciseItems.id, { onDelete: "cascade" }),
    muscle: text().notNull(),
    role: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.exercise_item_id, t.muscle] })],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    role: text().notNull(),
    text: text().notNull(),
    cards: text({ mode: "json" }).$type<{ type: "entry"; id: string }[]>().notNull(),
    status: text(),
    error_code: text(),
    reply_to: text().unique(),
    sent_at: text(),
    created_at: text().notNull(),
  },
  (t) => [index("messages_date_idx").on(t.date)],
);

/** One coach thread per day; `system` is frozen at the day's first message (spec §6.2). */
export const coachThreads = sqliteTable("coach_threads", {
  date: text().primaryKey(),
  system: text().notNull(),
  created_at: text().notNull(),
});

/** The exact Claude API turns, replayed append-only. */
export const coachTurns = sqliteTable(
  "coach_turns",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    date: text().notNull(),
    seq: integer().notNull(),
    role: text().notNull(),
    blocks: text({ mode: "json" }).$type<unknown[]>().notNull(),
    message_id: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [uniqueIndex("coach_turns_date_seq_idx").on(t.date, t.seq)],
);
```

`server/src/db/types.ts`:

```ts
import type Database from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/** Something queries can run on: the database itself or a transaction. */
export type Sql = BaseSQLiteDatabase<"sync", Database.RunResult>;
```

- [ ] **Step 3: Generate the first migration**

Run: `npm run db:generate`
Expected: `[✓] Your SQL migration file ➜ drizzle/0000_<random_name>.sql`, and the file contains `CREATE TABLE` for all ten tables (`profile`, `days`, `entries`, `food_items`, `food_item_groups`, `exercise_items`, `exercise_muscles`, `messages`, `coach_threads`, `coach_turns`). Commit the generated files as they are — never hand-edit them.

- [ ] **Step 4: Write the failing test**

Append to `server/test/helpers.ts` (keep `makeProfile`; merge the imports at the top of the file):

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/open.ts";

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fitnessai-"));
}

/** A migrated database in a fresh temporary directory. Call `.close()` when done. */
export function openTestDb() {
  return openDatabase({ file: path.join(tempDir(), "fitness.db"), snapshotDir: null });
}
```

`server/test/db.test.ts`:

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/open.ts";
import { pruneSnapshots } from "../src/db/snapshot.ts";
import { openTestDb, tempDir } from "./helpers.ts";

describe("openDatabase", () => {
  it("applies the migrations and the NFS-safe settings", () => {
    const db = openTestDb();
    const tables = db.sqlite.prepare("select name from sqlite_master where type = 'table'").pluck().all();
    expect(tables).toEqual(expect.arrayContaining([
      "profile", "days", "entries", "food_items", "food_item_groups",
      "exercise_items", "exercise_muscles", "messages", "coach_threads", "coach_turns",
    ]));
    expect(db.sqlite.pragma("journal_mode", { simple: true })).toBe("delete");
    expect(db.sqlite.pragma("synchronous", { simple: true })).toBe(2); // FULL
    expect(db.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.sqlite.pragma("locking_mode", { simple: true })).toBe("exclusive");
    db.close();
  });

  it("refuses a second opener while the first holds the lock, and lets it in afterwards", () => {
    const file = path.join(tempDir(), "fitness.db");
    const first = openDatabase({ file, snapshotDir: null });
    expect(() => openDatabase({ file, snapshotDir: null, lockWaitMs: 50, lockRetryMs: 10 })).toThrow(/locked|busy/i);
    first.close();
    openDatabase({ file, snapshotDir: null, lockWaitMs: 50, lockRetryMs: 10 }).close();
  });

  it("snapshots an existing database before migrating", () => {
    const dir = tempDir();
    const file = path.join(dir, "fitness.db");
    const snapshots = path.join(dir, "snapshots");
    const first = openDatabase({ file, snapshotDir: snapshots });
    first.sqlite.exec("insert into coach_threads (date, system, created_at) values ('2026-10-03', 'x', 'now')");
    first.close();
    expect(fs.existsSync(snapshots)).toBe(false); // a brand-new file is not worth a snapshot

    openDatabase({ file, snapshotDir: snapshots }).close();
    const taken = fs.readdirSync(snapshots).filter((f) => f.startsWith("startup-"));
    expect(taken).toHaveLength(1);
    const copy = new Database(path.join(snapshots, taken[0]), { readonly: true });
    expect(copy.prepare("select count(*) from coach_threads").pluck().get()).toBe(1);
    copy.close();
  });
});

describe("pruneSnapshots", () => {
  it("keeps the newest files with the prefix and leaves the others alone", () => {
    const dir = tempDir();
    for (const name of ["fitness-2026-10-01.db", "fitness-2026-10-02.db", "fitness-2026-10-03.db", "startup-x.db"]) {
      fs.writeFileSync(path.join(dir, name), "");
    }
    expect(pruneSnapshots(dir, "fitness-", 2)).toEqual(["fitness-2026-10-01.db"]);
    expect(fs.readdirSync(dir).sort()).toEqual(["fitness-2026-10-02.db", "fitness-2026-10-03.db", "startup-x.db"]);
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/db/open.ts`.

- [ ] **Step 6: Implement**

`server/src/db/snapshot.ts`:

```ts
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** A consistent copy of the live database (VACUUM INTO), safe to back up while the app runs. */
export function snapshot(sqlite: Database.Database, dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  fs.rmSync(target, { force: true }); // VACUUM INTO refuses to overwrite
  sqlite.prepare("VACUUM INTO ?").run(target);
  return target;
}

/** Deletes all but the newest `keep` snapshots starting with `prefix`. Names sort by time. */
export function pruneSnapshots(dir: string, prefix: string, keep: number): string[] {
  const names = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".db")).sort();
  const remove = names.slice(0, Math.max(0, names.length - keep));
  for (const name of remove) fs.rmSync(path.join(dir, name));
  return remove;
}

/** A filesystem-safe timestamp that sorts chronologically. */
export function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
```

`server/src/db/open.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneSnapshots, snapshot, stamp } from "./snapshot.ts";
import type { Sql } from "./types.ts";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export interface OpenOptions {
  file: string;
  /** Where to put a snapshot of an existing database before migrating; null to skip. */
  snapshotDir: string | null;
  /** How long to wait for another process's lock to clear (default 2 minutes, spec §14.4). */
  lockWaitMs?: number;
  lockRetryMs?: number;
}

function isBusy(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err.code === "SQLITE_BUSY" || err.code === "SQLITE_LOCKED");
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Takes the database's write lock and keeps it for the life of the process.
 * Two pods sharing one SQLite file over NFS would corrupt it; with an exclusive
 * lock held, a second opener gets SQLITE_BUSY instead. A pod that died
 * uncleanly releases its lock when the NFS lease expires, hence the retry.
 */
function acquireExclusiveLock(sqlite: Database.Database, opts: OpenOptions): void {
  const deadline = Date.now() + (opts.lockWaitMs ?? 120_000);
  for (;;) {
    try {
      sqlite.exec("BEGIN EXCLUSIVE; COMMIT;");
      return;
    } catch (err) {
      if (!isBusy(err) || Date.now() >= deadline) throw err;
      sleep(opts.lockRetryMs ?? 5_000);
    }
  }
}

export function openDatabase(opts: OpenOptions) {
  fs.mkdirSync(path.dirname(opts.file), { recursive: true });
  const existed = fs.existsSync(opts.file) && fs.statSync(opts.file).size > 0;
  const sqlite = new Database(opts.file, { timeout: 0 });
  try {
    sqlite.pragma("locking_mode = EXCLUSIVE");
    acquireExclusiveLock(sqlite, opts);
    // WAL needs shared memory, which NFS cannot provide, so keep the rollback journal.
    sqlite.pragma("journal_mode = DELETE");
    sqlite.pragma("synchronous = FULL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("temp_store = MEMORY");
    if (existed && opts.snapshotDir) {
      snapshot(sqlite, opts.snapshotDir, `startup-${stamp(new Date())}.db`);
      pruneSnapshots(opts.snapshotDir, "startup-", 3);
    }
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: MIGRATIONS });
    const db: Sql = database;
    return { db, sqlite, close: () => sqlite.close() };
  } catch (err) {
    sqlite.close();
    throw err;
  }
}

export type OpenDatabase = ReturnType<typeof openDatabase>;
```

- [ ] **Step 7: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `db.test.ts` 4 tests pass; no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server
git commit -m "feat(server): SQLite schema, migrations, exclusive lock and snapshots"
```

---

### Task 6: Configuration from the environment

**Files:**
- Create: `server/src/config.ts`
- Test: `server/test/config.test.ts`

**Interfaces:**
- Produces: `EFFORTS`, `type Effort`, `interface AccessConfig { teamDomain; audience; ownerEmail; testJwks: string | null }`, `interface Config { nodeEnv; port; metricsPort; dataDir; webDist: string | null; access: AccessConfig | null; devAuthEmail: string | null; anthropic: { apiKey: string | null; model: string; effort: Effort }; coachBudgetMs; snapshotKeep }`, `class ConfigError`, `loadConfig(env: Record<string, string | undefined>): Config`.
- Rules: anything but `NODE_ENV=development`/`test` is production; `DEV_AUTH_EMAIL` only in development; without it, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `OWNER_EMAIL` are all required; `ACCESS_TEST_JWKS` is ignored in production; emails are lowercased.

- [ ] **Step 1: Write the failing test**

`server/test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const production = {
  NODE_ENV: "production",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "aud",
  OWNER_EMAIL: "Owner@Example.com",
};

describe("loadConfig", () => {
  it("loads production settings with the documented defaults", () => {
    const c = loadConfig(production);
    expect(c).toMatchObject({
      nodeEnv: "production", port: 8080, metricsPort: 9464, dataDir: "./.data", webDist: null,
      devAuthEmail: null, coachBudgetMs: 90_000, snapshotKeep: 7,
    });
    expect(c.access).toEqual({ teamDomain: "team.cloudflareaccess.com", audience: "aud", ownerEmail: "owner@example.com", testJwks: null });
    expect(c.anthropic).toEqual({ apiKey: null, model: "claude-opus-5-5", effort: "medium" });
  });

  it("treats a missing NODE_ENV as production", () => {
    const { NODE_ENV: _omitted, ...rest } = production;
    expect(loadConfig(rest).nodeEnv).toBe("production");
  });

  it("refuses to start without the Access settings", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, OWNER_EMAIL: " " })).toThrow(ConfigError);
  });

  it("only honours DEV_AUTH_EMAIL in development", () => {
    expect(() => loadConfig({ ...production, DEV_AUTH_EMAIL: "dev@localhost" })).toThrow(ConfigError);
    const dev = loadConfig({ NODE_ENV: "development", DEV_AUTH_EMAIL: "Dev@Localhost" });
    expect(dev.devAuthEmail).toBe("dev@localhost");
    expect(dev.access).toBeNull();
  });

  it("ignores ACCESS_TEST_JWKS in production", () => {
    expect(loadConfig({ ...production, ACCESS_TEST_JWKS: "{}" }).access?.testJwks).toBeNull();
    expect(loadConfig({ ...production, NODE_ENV: "test", ACCESS_TEST_JWKS: "{}" }).access?.testJwks).toBe("{}");
  });

  it("reads the Anthropic settings", () => {
    const c = loadConfig({ ...production, ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_EFFORT: "low" });
    expect(c.anthropic).toEqual({ apiKey: "k", model: "claude-sonnet-5-5", effort: "low" });
  });

  it("rejects an unknown effort level and a bad port", () => {
    expect(() => loadConfig({ ...production, ANTHROPIC_EFFORT: "extreme" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, PORT: "eighty" })).toThrow(ConfigError);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/config.ts`.

- [ ] **Step 3: Implement**

`server/src/config.ts`:

```ts
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  ownerEmail: string;
  /** A JSON key set that replaces Cloudflare's — tests only; always null in production. */
  testJwks: string | null;
}

export interface Config {
  nodeEnv: "production" | "development" | "test";
  port: number;
  metricsPort: number;
  dataDir: string;
  webDist: string | null;
  /** Null only in development with DEV_AUTH_EMAIL. */
  access: AccessConfig | null;
  devAuthEmail: string | null;
  anthropic: { apiKey: string | null; model: string; effort: Effort };
  coachBudgetMs: number;
  snapshotKeep: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function trimmed(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = trimmed(env, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

export function loadConfig(env: Env): Config {
  // Only an explicit "development" or "test" counts, so a container that forgets
  // NODE_ENV can never switch the development sign-in bypass on.
  const nodeEnv = env.NODE_ENV === "development" || env.NODE_ENV === "test" ? env.NODE_ENV : "production";

  const devAuthEmail = trimmed(env, "DEV_AUTH_EMAIL")?.toLowerCase() ?? null;
  if (devAuthEmail && nodeEnv !== "development") {
    throw new ConfigError("DEV_AUTH_EMAIL is only allowed when NODE_ENV=development");
  }

  const teamDomain = trimmed(env, "ACCESS_TEAM_DOMAIN");
  const audience = trimmed(env, "ACCESS_AUD");
  const ownerEmail = trimmed(env, "OWNER_EMAIL")?.toLowerCase() ?? null;
  let access: AccessConfig | null = null;
  if (teamDomain && audience && ownerEmail) {
    access = { teamDomain, audience, ownerEmail, testJwks: nodeEnv === "production" ? null : trimmed(env, "ACCESS_TEST_JWKS") };
  } else if (!devAuthEmail) {
    throw new ConfigError(
      "ACCESS_TEAM_DOMAIN, ACCESS_AUD and OWNER_EMAIL must all be set. Refusing to start: without them no request can be authenticated.",
    );
  }

  const effort = trimmed(env, "ANTHROPIC_EFFORT") ?? "medium";
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new ConfigError(`ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}, got "${effort}"`);
  }

  return {
    nodeEnv,
    port: positiveInt(env, "PORT", 8080),
    metricsPort: positiveInt(env, "METRICS_PORT", 9464),
    dataDir: trimmed(env, "DATA_DIR") ?? "./.data",
    webDist: trimmed(env, "WEB_DIST"),
    access,
    devAuthEmail,
    anthropic: {
      apiKey: trimmed(env, "ANTHROPIC_API_KEY"),
      model: trimmed(env, "ANTHROPIC_MODEL") ?? "claude-opus-5-5",
      effort: effort as Effort,
    },
    coachBudgetMs: positiveInt(env, "COACH_BUDGET_MS", 90_000),
    snapshotKeep: positiveInt(env, "SNAPSHOT_KEEP", 7),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `config.test.ts` 7 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/test/config.test.ts
git commit -m "feat(server): configuration with fail-closed Access settings"
```

---

### Task 7: Cloudflare Access verification

**Files:**
- Create: `server/src/auth/access.ts`
- Modify: `server/test/helpers.ts` (add `makeAccess`)
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Consumes: `AccessConfig` (Task 6).
- Produces: `interface Identity { email: string }`, `interface Verifier { verify(token: string): Promise<Identity> }`, `class AuthError`, `keySetFor(access: AccessConfig): JWTVerifyGetKey`, `createVerifier(access: AccessConfig, keys?: JWTVerifyGetKey): Verifier`, `devVerifier(email: string): Verifier`.
- Produces (`helpers.ts`): `makeAccess(ownerEmail = "owner@example.com")` → `{ access: AccessConfig; token(claims?: TokenClaims): Promise<string>; verifier: Verifier }`, with `interface TokenClaims { email?: string | null; aud?: string; iss?: string; exp?: string | number }` (`email: null` omits the claim).

- [ ] **Step 1: Dependency**

```bash
npm install -w server jose@^6.2.12
```

- [ ] **Step 2: Test helper and failing test**

Append to `server/test/helpers.ts` (merge imports at the top):

```ts
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createVerifier } from "../src/auth/access.ts";
import type { AccessConfig } from "../src/config.ts";

export interface TokenClaims {
  /** `null` leaves the claim out entirely. */
  email?: string | null;
  aud?: string;
  iss?: string;
  exp?: string | number;
}

/** A local Access stand-in: a key pair, the matching config, and a token minter. */
export async function makeAccess(ownerEmail = "owner@example.com") {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const access: AccessConfig = {
    teamDomain: "test.cloudflareaccess.com",
    audience: "test-aud",
    ownerEmail,
    testJwks: JSON.stringify({ keys: [jwk] }),
  };
  async function token(claims: TokenClaims = {}): Promise<string> {
    const email = claims.email === undefined ? ownerEmail : claims.email;
    return new SignJWT(email === null ? {} : { email })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(claims.iss ?? `https://${access.teamDomain}`)
      .setAudience(claims.aud ?? access.audience)
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? "5m")
      .sign(privateKey);
  }
  return { access, token, verifier: createVerifier(access) };
}
```

`server/test/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { devVerifier } from "../src/auth/access.ts";
import { makeAccess } from "./helpers.ts";

describe("createVerifier", () => {
  it("accepts the owner's token whatever the email's case", async () => {
    const auth = await makeAccess("owner@example.com");
    const identity = await auth.verifier.verify(await auth.token({ email: "Owner@Example.COM" }));
    expect(identity).toEqual({ email: "owner@example.com" });
  });

  it("rejects anyone who is not the owner, even with a valid token", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify(await auth.token({ email: "intruder@example.com" }))).rejects.toThrow();
    await expect(auth.verifier.verify(await auth.token({ email: null }))).rejects.toThrow();
  });

  it("rejects tokens for another application or team", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify(await auth.token({ aud: "other-aud" }))).rejects.toThrow();
    await expect(auth.verifier.verify(await auth.token({ iss: "https://other.cloudflareaccess.com" }))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const auth = await makeAccess();
    const expired = await auth.token({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(auth.verifier.verify(expired)).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    const auth = await makeAccess();
    const impostor = await makeAccess();
    await expect(auth.verifier.verify(await impostor.token())).rejects.toThrow();
  });

  it("rejects a missing or malformed token", async () => {
    const auth = await makeAccess();
    await expect(auth.verifier.verify("")).rejects.toThrow();
    await expect(auth.verifier.verify("not.a.jwt")).rejects.toThrow();
  });
});

describe("devVerifier", () => {
  it("treats every request as the configured development user", async () => {
    await expect(devVerifier("dev@localhost").verify("")).resolves.toEqual({ email: "dev@localhost" });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/auth/access.ts`.

- [ ] **Step 4: Implement**

`server/src/auth/access.ts`:

```ts
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { AccessConfig } from "../config.ts";

// Cloudflare Access sends a signed assertion in Cf-Access-Jwt-Assertion. Only the
// signed token is evidence; the plain email header is ignored (spec §13).

export interface Identity {
  email: string;
}

export interface Verifier {
  verify(token: string): Promise<Identity>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function keySetFor(access: AccessConfig): JWTVerifyGetKey {
  if (access.testJwks) return createLocalJWKSet(JSON.parse(access.testJwks));
  // Handles caching and refetching on an unknown key id, so key rotation is a non-event.
  return createRemoteJWKSet(new URL(`https://${access.teamDomain}/cdn-cgi/access/certs`));
}

export function createVerifier(access: AccessConfig, keys: JWTVerifyGetKey = keySetFor(access)): Verifier {
  const issuer = `https://${access.teamDomain}`;
  return {
    async verify(token) {
      // Checks the signature, issuer, audience and expiry. Skipping the issuer would
      // accept a correctly signed token minted for a different Access team.
      const { payload } = await jwtVerify(token, keys, { issuer, audience: access.audience });
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!email) throw new AuthError("the token carries no email claim");
      // Even if the Access policy is ever loosened, only the owner gets in.
      if (email !== access.ownerEmail) throw new AuthError("not the owner");
      return { email };
    },
  };
}

/** Local development only (config refuses it outside NODE_ENV=development). */
export function devVerifier(email: string): Verifier {
  return {
    async verify() {
      return { email };
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `auth.test.ts` 7 tests pass; no errors.

- [ ] **Step 6: Commit**

```bash
git add package-lock.json server
git commit -m "feat(server): verify Cloudflare Access tokens for the owner only"
```

---

### Task 8: The Fastify app — auth hook, health route, PWA serving

**Files:**
- Create: `server/src/deps.ts`, `server/src/app.ts`, `server/src/routes/index.ts`, `server/src/routes/health.ts`
- Modify: `server/test/helpers.ts` (add `NOW`, `testApp`, `TestApp`)
- Test: `server/test/app.test.ts`

**Interfaces:**
- Consumes: `Verifier`, `Identity` (Task 7), `Sql` (Task 5).
- Produces (`deps.ts`): `interface AppDeps { db: Sql; verifier: Verifier; now: () => Date; webDist: string | null; logger?: boolean }` (later tasks add fields).
- Produces (`app.ts`): `buildApp(deps: AppDeps): FastifyInstance`, `cacheControlFor(filePath: string): string`; augments `FastifyRequest` with `identity: Identity | null`.
- Produces (`routes/index.ts`): `registerRoutes(app: FastifyInstance, deps: AppDeps): void` — later tasks add one line each.
- Produces (`helpers.ts`): `NOW = new Date("2026-10-03T12:00:00.000Z")` (13:00 in London, a Saturday), `testApp(opts?: { now?: Date; webDist?: string | null })` → `{ app, db, auth, headers, close() }`, `type TestApp`.

- [ ] **Step 1: Dependencies**

```bash
npm install -w server fastify@^5.12.5 @fastify/static@^10.1.5
```

- [ ] **Step 2: Test helper and failing test**

Append to `server/test/helpers.ts` (merge imports):

```ts
import { buildApp } from "../src/app.ts";

/** The clock every test app uses: 13:00 BST on Saturday 3 October 2026. */
export const NOW = new Date("2026-10-03T12:00:00.000Z");

export async function testApp(opts: { now?: Date; webDist?: string | null } = {}) {
  const auth = await makeAccess();
  const database = openTestDb();
  const app = buildApp({
    db: database.db,
    verifier: auth.verifier,
    now: () => opts.now ?? NOW,
    webDist: opts.webDist ?? null,
  });
  await app.ready();
  const owner = await auth.token();
  return {
    app,
    db: database.db,
    auth,
    headers: { "cf-access-jwt-assertion": owner },
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;
```

`server/test/app.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheControlFor } from "../src/app.ts";
import { tempDir, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe("authentication", () => {
  it("leaves /api/health open", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("answers every other /api route with a bodiless 401 without a valid owner token", async () => {
    ctx = await testApp();
    const intruder = await ctx.auth.token({ email: "intruder@example.com" });
    for (const headers of [{}, { "cf-access-jwt-assertion": "garbage" }, { "cf-access-jwt-assertion": intruder }]) {
      const res = await ctx.app.inject({ method: "GET", url: "/api/anything", headers });
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe("");
    }
  });

  it("lets the owner through to a JSON 404 for unknown API routes", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/anything", headers: ctx.headers });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("does not let a query string borrow the health exemption", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/api/anything?next=/api/health" })).statusCode).toBe(401);
  });
});

describe("serving the PWA", () => {
  function webDist(): string {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><div id="root"></div>');
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
    return dir;
  }

  it("answers app routes with index.html, never cached", async () => {
    ctx = await testApp({ webDist: webDist() });
    const res = await ctx.app.inject({ method: "GET", url: "/day/today" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    ctx = await testApp({ webDist: webDist() });
    const res = await ctx.app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers 404 when there is no web build", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
  });
});

describe("cacheControlFor", () => {
  it("caches only hashed build assets", () => {
    expect(cacheControlFor("/app/web/dist/assets/index-abc.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("/app/web/dist/sw.js")).toBe("no-cache");
    expect(cacheControlFor("/app/web/dist/index.html")).toBe("no-cache");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/app.ts`.

- [ ] **Step 4: Implement**

`server/src/deps.ts`:

```ts
import type { Verifier } from "./auth/access.ts";
import type { Sql } from "./db/types.ts";

/** Everything the HTTP layer needs, injected so tests can replace any of it. */
export interface AppDeps {
  db: Sql;
  verifier: Verifier;
  now: () => Date;
  /** The built PWA (web/dist); null in development and in tests. */
  webDist: string | null;
  logger?: boolean;
}
```

`server/src/routes/health.ts`:

```ts
import type { FastifyInstance } from "fastify";

export function registerHealth(app: FastifyInstance): void {
  // Exempt from auth (see app.ts) so the kubelet's probes reach it. Reveals nothing.
  app.get("/api/health", async () => ({ ok: true }));
}
```

`server/src/routes/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { registerHealth } from "./health.ts";

export function registerRoutes(app: FastifyInstance, _deps: AppDeps): void {
  registerHealth(app);
}
```

`server/src/app.ts`:

```ts
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import type { Identity } from "./auth/access.ts";
import type { AppDeps } from "./deps.ts";
import { registerRoutes } from "./routes/index.ts";

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

function pathOf(url: string): string {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

/** Hashed build assets never change; everything else (index.html, sw.js, the manifest) must revalidate. */
export function cacheControlFor(filePath: string): string {
  return /[\\/]assets[\\/]/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache";
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 1_048_576 });
  app.decorateRequest("identity", null);

  // Fail closed: everything under /api/ except the health probe needs the owner's
  // Access token (spec §13). A refusal carries no body, so a caller learns nothing.
  app.addHook("onRequest", async (req, reply) => {
    const path = pathOf(req.url);
    if (!path.startsWith("/api/") || path === "/api/health") return;
    const header = req.headers["cf-access-jwt-assertion"];
    try {
      req.identity = await deps.verifier.verify(typeof header === "string" ? header : "");
    } catch {
      return reply.code(401).send();
    }
  });

  app.setErrorHandler((err, req, reply) => {
    // Fastify types the error as unknown; client errors (bad JSON, body too large) carry a 4xx statusCode.
    const code = (err as { statusCode?: unknown }).statusCode;
    const status = typeof code === "number" && code < 500 ? code : 500;
    if (status === 500) req.log.error({ err }, "unhandled error");
    return reply.code(status).send({ error: status === 500 ? "internal" : "bad_request" });
  });

  registerRoutes(app, deps);

  const webDist = deps.webDist && fs.existsSync(deps.webDist) ? deps.webDist : null;
  if (webDist) {
    void app.register(fastifyStatic, {
      root: webDist,
      wildcard: true,
      setHeaders: (res, filePath) => res.header("cache-control", cacheControlFor(filePath)),
    });
  }

  // Unknown GETs outside /api/ are client-side routes of the PWA: answer with index.html.
  app.setNotFoundHandler((req, reply) => {
    if (!webDist || req.method !== "GET" || pathOf(req.url).startsWith("/api/")) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });

  return app;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `app.test.ts` 8 tests pass; no errors.

- [ ] **Step 6: Commit**

```bash
git add package-lock.json server
git commit -m "feat(server): Fastify app with fail-closed auth and PWA serving"
```

---

### Task 9: Entries persistence

**Files:**
- Create: `server/src/log/entries.ts`
- Modify: `server/test/helpers.ts` (add `sampleFood`, `sampleExercise`, `sampleEntry`)
- Test: `server/test/entries.test.ts`

**Interfaces:**
- Consumes: tables from Task 5; `Entry`, `FoodItem`, `ExerciseItem`, vocab types from shared.
- Produces:
  - `interface FoodItemData` — every column of a food item except ids/position, plus `groups: { group: FoodGroup; portions: number }[]`.
  - `interface ExerciseItemData` — every column of an exercise item except ids/position, plus `muscles: { muscle: Muscle; role: MuscleRole }[]`.
  - `interface NewEntry { id; date; logged_at; source: EntrySource; message_id: string | null; foods: FoodItemData[]; exercises: ExerciseItemData[] }`
  - `normalizeGroups(groups)`, `normalizeMuscles(muscles)`
  - `insertEntry(sql: Sql, entry: NewEntry, nowIso: string): void` — callers wrap it in a transaction.
  - `replaceEntryItems(sql, entryId, foods, exercises, nowIso): boolean` — sets `edited`.
  - `deleteEntry(sql, entryId): boolean`, `getEntry(sql, id): Entry | null`, `listEntries(sql, date): Entry[]` (ordered by `logged_at`, tombstones excluded).
- Produces (`helpers.ts`): `sampleFood(overrides?)`, `sampleExercise(overrides?)`, `sampleEntry(overrides?)` (date 2026-10-03, source `manual`, one food).

- [ ] **Step 1: Test helpers and failing test**

Append to `server/test/helpers.ts` (merge imports):

```ts
import { randomUUID } from "node:crypto";
import type { ExerciseItemData, FoodItemData, NewEntry } from "../src/log/entries.ts";

export function sampleFood(overrides: Partial<FoodItemData> = {}): FoodItemData {
  return {
    name: "Eggs", quantity: "2 large", grams: 120, kcal: 156, protein_g: 13, carbs_g: 1, fat_g: 11, fibre_g: 0,
    saturated_fat_g: 3.3, sugars_g: 0.4, salt_g: 0.4, fluid_ml: 0, alcohol_units: 0,
    assumption: "", saved_food_id: null, groups: [], ...overrides,
  };
}

export function sampleExercise(overrides: Partial<ExerciseItemData> = {}): ExerciseItemData {
  return {
    name: "Run", category: "cardio", duration_min: 30, sets: null, reps: null, weight_kg: null,
    distance_km: 5, avg_hr: null, met: 9, kcal: 320, kcal_measured: false, assumption: "",
    muscles: [{ muscle: "quads", role: "primary" }], ...overrides,
  };
}

export function sampleEntry(overrides: Partial<NewEntry> = {}): NewEntry {
  return {
    id: randomUUID(), date: "2026-10-03", logged_at: "2026-10-03T07:00:00.000Z", source: "manual",
    message_id: null, foods: [sampleFood()], exercises: [], ...overrides,
  };
}
```

`server/test/entries.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteEntry, getEntry, insertEntry, listEntries, normalizeGroups, normalizeMuscles, replaceEntryItems,
} from "../src/log/entries.ts";
import { openTestDb, sampleEntry, sampleExercise, sampleFood } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
let db: ReturnType<typeof openTestDb> | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe("entries", () => {
  it("stores an entry with its foods, groups, exercises and muscles", () => {
    db = openTestDb();
    const entry = sampleEntry({
      foods: [sampleFood({ groups: [{ group: "wholegrains", portions: 1 }, { group: "wholegrains", portions: 0.5 }, { group: "fruit", portions: 1 }] })],
      exercises: [sampleExercise({ muscles: [{ muscle: "quads", role: "secondary" }, { muscle: "quads", role: "primary" }, { muscle: "calves", role: "secondary" }] })],
    });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));

    const stored = getEntry(db.db, entry.id);
    expect(stored).toMatchObject({ id: entry.id, date: "2026-10-03", source: "manual", edited: false, message_id: null });
    expect(stored?.foods[0]).toMatchObject({ name: "Eggs", kcal: 156, saturated_fat_g: 3.3, position: 0 });
    expect(stored?.foods[0].groups).toEqual([{ group: "fruit", portions: 1 }, { group: "wholegrains", portions: 1.5 }]);
    expect(stored?.exercises[0]).toMatchObject({ name: "Run", kcal: 320, kcal_measured: false, category: "cardio" });
    expect(stored?.exercises[0].muscles).toEqual([{ muscle: "quads", role: "primary" }, { muscle: "calves", role: "secondary" }]);
  });

  it("lists one day's entries in time order", () => {
    db = openTestDb();
    const late = sampleEntry({ logged_at: "2026-10-03T18:00:00.000Z" });
    const early = sampleEntry({ logged_at: "2026-10-03T07:00:00.000Z" });
    const otherDay = sampleEntry({ date: "2026-10-02", logged_at: "2026-10-02T07:00:00.000Z" });
    db.db.transaction((tx) => [late, early, otherDay].forEach((e) => insertEntry(tx, e, NOW_ISO)));
    expect(listEntries(db.db, "2026-10-03").map((e) => e.id)).toEqual([early.id, late.id]);
  });

  it("replaces an entry's items and marks it edited", () => {
    db = openTestDb();
    const entry = sampleEntry();
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    const replaced = db.db.transaction((tx) =>
      replaceEntryItems(tx, entry.id, [sampleFood({ name: "Toast", kcal: 90 }), sampleFood({ name: "Butter", kcal: 70 })], [], NOW_ISO),
    );
    expect(replaced).toBe(true);
    const stored = getEntry(db.db, entry.id);
    expect(stored?.edited).toBe(true);
    expect(stored?.foods.map((f) => [f.name, f.position])).toEqual([["Toast", 0], ["Butter", 1]]);
  });

  it("deletes an entry together with everything under it", () => {
    db = openTestDb();
    const entry = sampleEntry({
      foods: [sampleFood({ groups: [{ group: "fruit", portions: 1 }] })],
      exercises: [sampleExercise()],
    });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    expect(deleteEntry(db.db, entry.id)).toBe(true);
    for (const table of ["food_items", "food_item_groups", "exercise_items", "exercise_muscles"]) {
      expect(db.sqlite.prepare(`select count(*) from ${table}`).pluck().get()).toBe(0);
    }
  });

  it("reports missing entries", () => {
    db = openTestDb();
    expect(getEntry(db.db, "nope")).toBeNull();
    expect(deleteEntry(db.db, "nope")).toBe(false);
    expect(db.db.transaction((tx) => replaceEntryItems(tx, "nope", [sampleFood()], [], NOW_ISO))).toBe(false);
  });
});

describe("normalizers", () => {
  it("sum repeated food groups and drop empty ones", () => {
    expect(normalizeGroups([{ group: "fruit", portions: 1 }, { group: "fruit", portions: 1 }, { group: "legumes", portions: 0 }])).toEqual([
      { group: "fruit", portions: 2 },
    ]);
  });

  it("keep one row per muscle, preferring primary", () => {
    expect(normalizeMuscles([{ muscle: "core", role: "primary" }, { muscle: "core", role: "secondary" }])).toEqual([
      { muscle: "core", role: "primary" },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/log/entries.ts`.

- [ ] **Step 3: Implement**

`server/src/log/entries.ts`:

```ts
import { and, asc, eq, inArray, isNull, sql as rawSql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { entries, exerciseItems, exerciseMuscles, foodItemGroups, foodItems } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { FOOD_GROUPS, MUSCLES } from "../shared.ts";
import type {
  Entry, EntrySource, ExerciseCategory, ExerciseItem, FoodGroup, FoodItem, Muscle, MuscleRole,
} from "../shared.ts";

export interface FoodItemData {
  name: string;
  quantity: string;
  grams: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  saturated_fat_g: number;
  sugars_g: number;
  salt_g: number;
  fluid_ml: number;
  alcohol_units: number;
  assumption: string;
  saved_food_id: string | null;
  groups: { group: FoodGroup; portions: number }[];
}

export interface ExerciseItemData {
  name: string;
  category: ExerciseCategory;
  duration_min: number | null;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  distance_km: number | null;
  avg_hr: number | null;
  met: number | null;
  kcal: number;
  kcal_measured: boolean;
  assumption: string;
  muscles: { muscle: Muscle; role: MuscleRole }[];
}

export interface NewEntry {
  id: string;
  date: string;
  logged_at: string;
  source: EntrySource;
  message_id: string | null;
  foods: FoodItemData[];
  exercises: ExerciseItemData[];
}

/** One row per food group: repeats are summed and empty portions dropped. */
export function normalizeGroups(groups: FoodItemData["groups"]): FoodItemData["groups"] {
  const totals = new Map<FoodGroup, number>();
  for (const g of groups) totals.set(g.group, (totals.get(g.group) ?? 0) + g.portions);
  return [...totals].filter(([, portions]) => portions > 0).map(([group, portions]) => ({ group, portions }));
}

/** One row per muscle; if a muscle is listed twice, primary wins. */
export function normalizeMuscles(muscles: ExerciseItemData["muscles"]): ExerciseItemData["muscles"] {
  const roles = new Map<Muscle, MuscleRole>();
  for (const m of muscles) if (roles.get(m.muscle) !== "primary") roles.set(m.muscle, m.role);
  return [...roles].map(([muscle, role]) => ({ muscle, role }));
}

function insertItems(sql: Sql, entryId: string, foods: FoodItemData[], exercises: ExerciseItemData[]): void {
  foods.forEach(({ groups, ...food }, position) => {
    const id = randomUUID();
    sql.insert(foodItems).values({ ...food, id, entry_id: entryId, position }).run();
    for (const g of normalizeGroups(groups)) {
      sql.insert(foodItemGroups).values({ food_item_id: id, food_group: g.group, portions: g.portions }).run();
    }
  });
  exercises.forEach(({ muscles, ...exercise }, position) => {
    const id = randomUUID();
    sql.insert(exerciseItems).values({ ...exercise, id, entry_id: entryId, position }).run();
    for (const m of normalizeMuscles(muscles)) {
      sql.insert(exerciseMuscles).values({ exercise_item_id: id, muscle: m.muscle, role: m.role }).run();
    }
  });
}

/** Inserts an entry with its items. Run inside a transaction. */
export function insertEntry(sql: Sql, entry: NewEntry, nowIso: string): void {
  const { foods, exercises, ...columns } = entry;
  sql.insert(entries).values({ ...columns, edited: false, created_at: nowIso, updated_at: nowIso }).run();
  insertItems(sql, entry.id, foods, exercises);
}

/** Swaps all of an entry's items for new ones and marks it edited. Run inside a transaction. */
export function replaceEntryItems(
  sql: Sql, entryId: string, foods: FoodItemData[], exercises: ExerciseItemData[], nowIso: string,
): boolean {
  const existing = sql.select({ id: entries.id }).from(entries).where(eq(entries.id, entryId)).get();
  if (!existing) return false;
  sql.delete(foodItems).where(eq(foodItems.entry_id, entryId)).run();
  sql.delete(exerciseItems).where(eq(exerciseItems.entry_id, entryId)).run();
  insertItems(sql, entryId, foods, exercises);
  sql.update(entries).set({ edited: true, updated_at: nowIso }).where(eq(entries.id, entryId)).run();
  return true;
}

/** Items, groups and muscles go with it (ON DELETE CASCADE). */
export function deleteEntry(sql: Sql, entryId: string): boolean {
  return sql.delete(entries).where(eq(entries.id, entryId)).run().changes > 0;
}

export function getEntry(sql: Sql, id: string): Entry | null {
  const rows = sql.select().from(entries).where(and(eq(entries.id, id), isNull(entries.deleted_at))).all();
  return hydrate(sql, rows)[0] ?? null;
}

export function listEntries(sql: Sql, date: string): Entry[] {
  const rows = sql
    .select()
    .from(entries)
    .where(and(eq(entries.date, date), isNull(entries.deleted_at)))
    // rowid breaks ties in insertion order, so equal timestamps still sort the same way every time.
    .orderBy(asc(entries.logged_at), asc(entries.created_at), asc(rawSql`rowid`))
    .all();
  return hydrate(sql, rows);
}

const groupRank = (group: FoodGroup) => FOOD_GROUPS.indexOf(group);
const muscleRank = (muscle: Muscle) => MUSCLES.indexOf(muscle);

function hydrate(sql: Sql, rows: (typeof entries.$inferSelect)[]): Entry[] {
  if (rows.length === 0) return [];
  const entryIds = rows.map((r) => r.id);
  const foods = sql.select().from(foodItems).where(inArray(foodItems.entry_id, entryIds)).orderBy(asc(foodItems.position)).all();
  const exercises = sql.select().from(exerciseItems).where(inArray(exerciseItems.entry_id, entryIds)).orderBy(asc(exerciseItems.position)).all();
  const groups = foods.length === 0 ? [] : sql.select().from(foodItemGroups).where(inArray(foodItemGroups.food_item_id, foods.map((f) => f.id))).all();
  const muscles = exercises.length === 0 ? [] : sql.select().from(exerciseMuscles).where(inArray(exerciseMuscles.exercise_item_id, exercises.map((x) => x.id))).all();

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    logged_at: row.logged_at,
    source: row.source as EntrySource,
    message_id: row.message_id,
    edited: row.edited,
    foods: foods
      .filter((f) => f.entry_id === row.id)
      .map(({ entry_id: _entryId, ...food }): FoodItem => ({
        ...food,
        groups: groups
          .filter((g) => g.food_item_id === food.id)
          .map((g) => ({ group: g.food_group as FoodGroup, portions: g.portions }))
          .sort((a, b) => groupRank(a.group) - groupRank(b.group)),
      })),
    exercises: exercises
      .filter((x) => x.entry_id === row.id)
      .map(({ entry_id: _entryId, ...exercise }): ExerciseItem => ({
        ...exercise,
        category: exercise.category as ExerciseCategory,
        muscles: muscles
          .filter((m) => m.exercise_item_id === exercise.id)
          .map((m) => ({ muscle: m.muscle as Muscle, role: m.role as MuscleRole }))
          .sort((a, b) => muscleRank(a.muscle) - muscleRank(b.muscle)),
      })),
  }));
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `entries.test.ts` 7 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): entries persistence with food groups and muscles"
```

---

### Task 10: Profile, day snapshots and the day view

**Files:**
- Create: `server/src/profile/profile.ts`, `server/src/days/days.ts`, `server/src/messages/messages.ts`
- Test: `server/test/days.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 9.
- Produces (`profile.ts`): `getProfile(sql): Profile | null`, `saveProfile(sql, profile: Profile, nowIso): Profile` (upserts row id 1).
- Produces (`days.ts`): `type DaySnapshot` (a `days` row), `snapshotValues(profile, date, nowIso): DaySnapshot` (pure; uses profile weight — M2 switches to the weigh-in average), `getDay(sql, date)`, `ensureDay(sql, profile, date, nowIso): DaySnapshot` (create once, never overwrite), `refreshDay(sql, profile, date, nowIso): void` (upsert), `sumTotals(entries): Totals`, `summarizeWorkouts(entries): WorkoutSummary`, `buildDayView(sql, profile, date, today, nowIso): DayView` (reads only; an untouched date gets targets from the current profile without storing a row).
- Produces (`messages.ts`, first part): `type MessageRow`, `toChatMessage(row): ChatMessage`, `listMessages(sql, date): ChatMessage[]` (ordered by `created_at`).

- [ ] **Step 1: Write the failing test**

`server/test/days.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildDayView, ensureDay, getDay, refreshDay } from "../src/days/days.ts";
import { insertEntry } from "../src/log/entries.ts";
import { getProfile, saveProfile } from "../src/profile/profile.ts";
import { makeProfile, openTestDb, sampleEntry, sampleExercise, sampleFood } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
let db: ReturnType<typeof openTestDb> | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe("profile", () => {
  it("round-trips through the database", () => {
    db = openTestDb();
    expect(getProfile(db.db)).toBeNull();
    const profile = makeProfile();
    saveProfile(db.db, profile, NOW_ISO);
    expect(getProfile(db.db)).toEqual(profile);
    saveProfile(db.db, { ...profile, weight_kg: 78 }, NOW_ISO);
    expect(getProfile(db.db)?.weight_kg).toBe(78);
  });
});

describe("day snapshots", () => {
  it("freeze a day's targets the first time the day is touched", () => {
    db = openTestDb();
    expect(ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO).base_kcal).toBeCloseTo(1863.125, 6);
    // A later profile change does not rewrite the stored day.
    expect(ensureDay(db.db, makeProfile({ weight_kg: 90 }), "2026-10-03", NOW_ISO).base_kcal).toBeCloseTo(1863.125, 6);
  });

  it("refresh on request (used for today when the profile changes)", () => {
    db = openTestDb();
    ensureDay(db.db, makeProfile(), "2026-10-03", NOW_ISO);
    refreshDay(db.db, makeProfile({ override_kcal: 2100 }), "2026-10-03", NOW_ISO);
    expect(getDay(db.db, "2026-10-03")?.base_kcal).toBe(2100);
  });
});

describe("buildDayView", () => {
  it("totals the food and adds back half the workout calories", () => {
    db = openTestDb();
    const profile = makeProfile();
    ensureDay(db.db, profile, "2026-10-03", NOW_ISO);
    db.db.transaction((tx) => {
      insertEntry(tx, sampleEntry({ foods: [sampleFood({ kcal: 500, protein_g: 30, saturated_fat_g: 5, fluid_ml: 250 })] }), NOW_ISO);
      insertEntry(tx, sampleEntry({ foods: [], exercises: [sampleExercise({ kcal: 400 })] }), NOW_ISO);
    });
    const view = buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO);
    expect(view.totals).toMatchObject({ kcal: 500, protein_g: 30, saturated_fat_g: 5, fluid_ml: 250 });
    expect(view.targets.workout_kcal).toBe(400);
    expect(view.targets.add_back_kcal).toBe(200);
    expect(view.targets.adjusted.kcal).toBeCloseTo(2063.125, 6);
    expect(view.entries).toHaveLength(2);
    expect(view.messages).toEqual([]);
    expect(view.today).toBe("2026-10-03");
  });

  it("gives an untouched past day targets from the current profile without storing it", () => {
    db = openTestDb();
    const view = buildDayView(db.db, makeProfile(), "2026-09-01", "2026-10-03", NOW_ISO);
    expect(view.targets.base.kcal).toBeCloseTo(1863.125, 6);
    expect(getDay(db.db, "2026-09-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/days/days.ts`.

- [ ] **Step 3: Implement**

`server/src/profile/profile.ts`:

```ts
import { eq } from "drizzle-orm";
import { profile as profileTable } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { ProfileInput } from "../shared.ts";
import type { Profile } from "../shared.ts";

export function getProfile(sql: Sql): Profile | null {
  const row = sql.select().from(profileTable).where(eq(profileTable.id, 1)).get();
  // Parsing narrows the text columns to their enums; unknown keys (id, updated_at) are dropped.
  return row ? ProfileInput.parse(row) : null;
}

export function saveProfile(sql: Sql, profile: Profile, nowIso: string): Profile {
  sql
    .insert(profileTable)
    .values({ ...profile, id: 1, updated_at: nowIso })
    .onConflictDoUpdate({ target: profileTable.id, set: { ...profile, updated_at: nowIso } })
    .run();
  return profile;
}
```

`server/src/messages/messages.ts`:

```ts
import { asc, eq, sql as rawSql } from "drizzle-orm";
import { messages } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import type { ChatMessage, MessageRole, MessageStatus } from "../shared.ts";

export type MessageRow = typeof messages.$inferSelect;

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    date: row.date,
    role: row.role as MessageRole,
    text: row.text,
    status: row.status as MessageStatus | null,
    error_code: row.error_code,
    cards: row.cards,
    reply_to: row.reply_to,
    sent_at: row.sent_at,
    created_at: row.created_at,
  };
}

export function listMessages(sql: Sql, date: string): ChatMessage[] {
  return sql
    .select()
    .from(messages)
    .where(eq(messages.date, date))
    // A reply can share its question's timestamp; rowid keeps insertion order.
    .orderBy(asc(messages.created_at), asc(rawSql`rowid`))
    .all()
    .map(toChatMessage);
}
```

`server/src/days/days.ts`:

```ts
import { eq } from "drizzle-orm";
import { days } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";
import { listEntries } from "../log/entries.ts";
import { listMessages } from "../messages/messages.ts";
import type { DayView, Entry, MacroTargets, Profile, Totals } from "../shared.ts";
import { adjustTargets, baselineTargets } from "../targets/targets.ts";
import type { WorkoutSummary } from "../targets/targets.ts";

export type DaySnapshot = typeof days.$inferSelect;

/** The targets a day would freeze today. Milestone 2 swaps the weight for the 7-day weigh-in average (spec §7.4). */
export function snapshotValues(profile: Profile, date: string, nowIso: string): DaySnapshot {
  const weight = profile.weight_kg;
  const base = baselineTargets(profile, weight, date);
  return {
    date,
    base_kcal: base.kcal,
    base_protein_g: base.protein_g,
    base_carbs_g: base.carbs_g,
    base_fat_g: base.fat_g,
    base_fibre_g: base.fibre_g,
    add_back_pct: profile.add_back_pct,
    weight_kg_used: weight,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export function getDay(sql: Sql, date: string): DaySnapshot | null {
  return sql.select().from(days).where(eq(days.date, date)).get() ?? null;
}

/** Creates the day's snapshot the first time anything touches it; never overwrites (spec §7.5). */
export function ensureDay(sql: Sql, profile: Profile, date: string, nowIso: string): DaySnapshot {
  const existing = getDay(sql, date);
  if (existing) return existing;
  const row = snapshotValues(profile, date, nowIso);
  sql.insert(days).values(row).run();
  return row;
}

/** Re-snapshots a day from the current profile. Only ever used for today. */
export function refreshDay(sql: Sql, profile: Profile, date: string, nowIso: string): void {
  const row = snapshotValues(profile, date, nowIso);
  sql
    .insert(days)
    .values(row)
    .onConflictDoUpdate({
      target: days.date,
      set: {
        base_kcal: row.base_kcal,
        base_protein_g: row.base_protein_g,
        base_carbs_g: row.base_carbs_g,
        base_fat_g: row.base_fat_g,
        base_fibre_g: row.base_fibre_g,
        add_back_pct: row.add_back_pct,
        weight_kg_used: row.weight_kg_used,
        updated_at: nowIso,
      },
    })
    .run();
}

function baseOf(day: DaySnapshot): MacroTargets {
  return { kcal: day.base_kcal, protein_g: day.base_protein_g, carbs_g: day.base_carbs_g, fat_g: day.base_fat_g, fibre_g: day.base_fibre_g };
}

const TOTAL_KEYS = [
  "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g",
  "saturated_fat_g", "sugars_g", "salt_g", "fluid_ml", "alcohol_units",
] as const satisfies readonly (keyof Totals)[];

export function sumTotals(list: Entry[]): Totals {
  const totals: Totals = {
    kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0,
    saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0,
  };
  for (const entry of list) for (const food of entry.foods) for (const key of TOTAL_KEYS) totals[key] += food[key];
  return totals;
}

export function summarizeWorkouts(list: Entry[]): WorkoutSummary {
  let workoutKcal = 0;
  let strengthDay = false;
  for (const entry of list) {
    for (const item of entry.exercises) {
      workoutKcal += item.kcal;
      if (item.category === "strength") strengthDay = true;
    }
  }
  return { workoutKcal, strengthDay };
}

/** Everything the Today screen shows for one date. Reads only. */
export function buildDayView(sql: Sql, profile: Profile, date: string, today: string, nowIso: string): DayView {
  const snapshot = getDay(sql, date) ?? snapshotValues(profile, date, nowIso);
  const list = listEntries(sql, date);
  const t = adjustTargets(baseOf(snapshot), snapshot.add_back_pct, snapshot.weight_kg_used, summarizeWorkouts(list));
  return {
    date,
    today,
    targets: { base: t.base, adjusted: t.adjusted, add_back_kcal: t.addBackKcal, workout_kcal: t.workoutKcal },
    totals: sumTotals(list),
    entries: list,
    messages: listMessages(sql, date),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `days.test.ts` 5 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): profile storage, day snapshots and the day view"
```

---

### Task 11: HTTP routes for profile, days and entries

**Files:**
- Create: `server/src/routes/http.ts`, `server/src/routes/profile.ts`, `server/src/routes/days.ts`, `server/src/routes/entries.ts`, `server/src/log/convert.ts`
- Modify: `server/src/routes/index.ts`
- Test: `server/test/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 8, 9, 10.
- Produces (`http.ts`): `parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.output<T> | null` — on failure sends `400 { error: "invalid_request", issues: [{ path, message }] }`.
- Produces (`convert.ts`): `foodData(input: FoodItemInput): FoodItemData`, `exerciseData(input: ExerciseItemInput, weightKg: number): ExerciseItemData` (kcal as given, else from MET and duration, else 0).
- Produces (routes):
  - `GET /api/profile` → `ProfileView` | 404 `no_profile`; `PUT /api/profile` → `ProfileView` (refreshes today's snapshot only).
  - `GET /api/days/:date` (`:date` may be `today`) → `DayView` | 409 `no_profile` | 400 `invalid_date`; creates today's row.
  - `POST /api/entries` → 201 `EntryResult` (200 with the existing entry when the id was already used) | 400 `future_date`; `PATCH /api/entries/:id` → `EntryResult` | 404; `DELETE /api/entries/:id` → `DeleteResult` | 404.

- [ ] **Step 1: Write the failing test**

`server/test/routes.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDay, getDay } from "../src/days/days.ts";
import { NOW, makeProfile, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

const PROFILE = {
  sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80,
  activity_level: "light", goal: "lose", goal_rate_kg_week: 0.5,
};

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function withProfile(extra: Record<string, unknown> = {}): Promise<TestApp> {
  const app = await testApp();
  const res = await app.app.inject({ method: "PUT", url: "/api/profile", headers: app.headers, payload: { ...PROFILE, ...extra } });
  expect(res.statusCode).toBe(200);
  return app;
}

describe("profile routes", () => {
  it("404 before a profile exists, then save one and return the calculated targets", async () => {
    ctx = await testApp();
    expect((await ctx.app.inject({ method: "GET", url: "/api/profile", headers: ctx.headers })).statusCode).toBe(404);
    const put = await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, override_kcal: 2000 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().profile).toMatchObject({ weight_kg: 80, override_kcal: 2000, timezone: "Europe/London" });
    expect(put.json().calculated.kcal).toBeCloseTo(1863.125, 6);
    const get = await ctx.app.inject({ method: "GET", url: "/api/profile", headers: ctx.headers });
    expect(get.json().profile.override_kcal).toBe(2000);
  });

  it("reject an invalid profile and say what is wrong", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, height_cm: 20 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request", issues: [{ path: "height_cm" }] });
  });

  it("update today's snapshot but leave earlier days alone", async () => {
    ctx = await withProfile();
    ensureDay(ctx.db, makeProfile(), "2026-10-02", NOW.toISOString());
    await ctx.app.inject({ method: "PUT", url: "/api/profile", headers: ctx.headers, payload: { ...PROFILE, override_kcal: 2100 } });
    expect(getDay(ctx.db, "2026-10-03")?.base_kcal).toBe(2100);
    expect(getDay(ctx.db, "2026-10-02")?.base_kcal).toBeCloseTo(1863.125, 6);
  });
});

describe("day routes", () => {
  it("ask for a profile first", async () => {
    ctx = await testApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_profile" });
  });

  it("return today's view and create today's row", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "GET", url: "/api/days/today", headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ date: "2026-10-03", today: "2026-10-03", entries: [], messages: [] });
    expect(getDay(ctx.db, "2026-10-03")).not.toBeNull();
  });

  it("reject a malformed date", async () => {
    ctx = await withProfile();
    expect((await ctx.app.inject({ method: "GET", url: "/api/days/2026-02-30", headers: ctx.headers })).statusCode).toBe(400);
  });
});

describe("entry routes", () => {
  const banana = { name: "Banana", kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 };

  it("add a manual entry and return the updated day", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry).toMatchObject({ id, source: "manual", logged_at: NOW.toISOString() });
    expect(res.json().day.totals.kcal).toBe(105);
  });

  it("treat a repeated id as the same entry", async () => {
    ctx = await withProfile();
    const payload = { id: randomUUID(), date: "2026-10-03", foods: [banana] };
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload });
    const again = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload });
    expect(again.statusCode).toBe(200);
    expect(again.json().day.entries).toHaveLength(1);
  });

  it("use the given local time", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-10-03", time: "07:30", foods: [banana] } });
    expect(res.json().entry.logged_at).toBe("2026-10-03T06:30:00.000Z");
  });

  it("work out exercise calories from MET and adjust the targets", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({
      method: "POST", url: "/api/entries", headers: ctx.headers,
      payload: { id: randomUUID(), date: "2026-10-03", exercises: [{ name: "Run", category: "cardio", duration_min: 30, met: 9 }] },
    });
    expect(res.json().entry.exercises[0].kcal).toBe(320); // (9 − 1) × 80 kg × 0.5 h
    expect(res.json().day.targets.add_back_kcal).toBe(160);
  });

  it("refuse a future date", async () => {
    ctx = await withProfile();
    const res = await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id: randomUUID(), date: "2026-10-04", foods: [banana] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "future_date" });
  });

  it("replace items with PATCH and mark the entry edited", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    const res = await ctx.app.inject({ method: "PATCH", url: `/api/entries/${id}`, headers: ctx.headers, payload: { foods: [{ ...banana, kcal: 120 }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry).toMatchObject({ edited: true, foods: [{ kcal: 120 }] });
    expect(res.json().day.totals.kcal).toBe(120);
  });

  it("delete with DELETE, then 404", async () => {
    ctx = await withProfile();
    const id = randomUUID();
    await ctx.app.inject({ method: "POST", url: "/api/entries", headers: ctx.headers, payload: { id, date: "2026-10-03", foods: [banana] } });
    const res = await ctx.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().day.entries).toEqual([]);
    expect((await ctx.app.inject({ method: "DELETE", url: `/api/entries/${id}`, headers: ctx.headers })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — the profile, day and entry routes answer 404 (`expected 404 to be 200` and similar).

- [ ] **Step 3: Implement**

`server/src/routes/http.ts`:

```ts
import type { FastifyReply } from "fastify";
import type { z } from "zod";

/** Parses a request body. On failure sends a 400 listing each problem and returns null. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.output<T> | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  void reply.code(400).send({
    error: "invalid_request",
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return null;
}
```

`server/src/log/convert.ts`:

```ts
import type { ExerciseItemInput, FoodItemInput } from "../shared.ts";
import { exerciseKcal } from "../targets/targets.ts";
import type { ExerciseItemData, FoodItemData } from "./entries.ts";

export function foodData(input: FoodItemInput): FoodItemData {
  return { ...input, saved_food_id: null };
}

/** Uses the kcal given; otherwise derives active kcal from MET and duration; otherwise 0. */
export function exerciseData(input: ExerciseItemInput, weightKg: number): ExerciseItemData {
  const derived = input.met !== null && input.duration_min !== null ? exerciseKcal(input.met, weightKg, input.duration_min) : 0;
  return { ...input, kcal: input.kcal ?? derived, kcal_measured: false };
}
```

`server/src/routes/profile.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { refreshDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile, saveProfile } from "../profile/profile.ts";
import { ProfileInput } from "../shared.ts";
import type { Profile, ProfileView } from "../shared.ts";
import { baselineTargets } from "../targets/targets.ts";
import { todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

function profileView(profile: Profile, now: Date): ProfileView {
  return { profile, calculated: baselineTargets(profile, profile.weight_kg, todayIn(profile.timezone, now), false) };
}

export function registerProfileRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/profile", async (_req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(404).send({ error: "no_profile" });
    return profileView(profile, deps.now());
  });

  app.put("/api/profile", async (req, reply) => {
    const profile = parseBody(ProfileInput, req.body, reply);
    if (!profile) return reply;
    const now = deps.now();
    const nowIso = now.toISOString();
    // Today's targets follow the new profile; past days keep their snapshot (spec §7.5).
    deps.db.transaction((tx) => {
      saveProfile(tx, profile, nowIso);
      refreshDay(tx, profile, todayIn(profile.timezone, now), nowIso);
    });
    return profileView(profile, now);
  });
}
```

`server/src/routes/days.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getProfile } from "../profile/profile.ts";
import { isIsoDate } from "../shared.ts";
import { todayIn } from "../time.ts";

export function registerDayRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { date: string } }>("/api/days/:date", async (req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    const date = req.params.date === "today" ? today : req.params.date;
    if (!isIsoDate(date)) return reply.code(400).send({ error: "invalid_date" });
    // Opening today creates its row, so a new day page simply exists (spec §7.5).
    if (date === today) ensureDay(deps.db, profile, date, nowIso);
    return buildDayView(deps.db, profile, date, today, nowIso);
  });
}
```

`server/src/routes/entries.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { exerciseData, foodData } from "../log/convert.ts";
import { deleteEntry, getEntry, insertEntry, replaceEntryItems } from "../log/entries.ts";
import { getProfile } from "../profile/profile.ts";
import { EntryPatch, ManualEntryInput } from "../shared.ts";
import type { DeleteResult, EntryResult, Profile } from "../shared.ts";
import { todayIn, zonedTimeToInstant } from "../time.ts";
import { parseBody } from "./http.ts";

function entryResult(deps: AppDeps, profile: Profile, id: string, now: Date): EntryResult {
  const entry = getEntry(deps.db, id);
  if (!entry) throw new Error(`entry ${id} disappeared`);
  return { entry, day: buildDayView(deps.db, profile, entry.date, todayIn(profile.timezone, now), now.toISOString()) };
}

export function registerEntryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/entries", async (req, reply) => {
    const input = parseBody(ManualEntryInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    if (input.date > today) return reply.code(400).send({ error: "future_date" });

    // The id is made on the phone, so sending the same entry twice is harmless.
    if (!getEntry(deps.db, input.id)) {
      const loggedAt =
        input.time !== null ? zonedTimeToInstant(input.date, input.time, profile.timezone)
        : input.date === today ? now
        : zonedTimeToInstant(input.date, "12:00", profile.timezone);
      deps.db.transaction((tx) => {
        const day = ensureDay(tx, profile, input.date, nowIso);
        insertEntry(tx, {
          id: input.id,
          date: input.date,
          logged_at: loggedAt.toISOString(),
          source: "manual",
          message_id: null,
          foods: input.foods.map(foodData),
          exercises: input.exercises.map((x) => exerciseData(x, day.weight_kg_used)),
        }, nowIso);
      });
      reply.code(201);
    }
    return entryResult(deps, profile, input.id, now);
  });

  app.patch<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const patch = parseBody(EntryPatch, req.body, reply);
    if (!patch) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const existing = getEntry(deps.db, req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const now = deps.now();
    const nowIso = now.toISOString();
    deps.db.transaction((tx) => {
      const day = ensureDay(tx, profile, existing.date, nowIso);
      replaceEntryItems(tx, existing.id, patch.foods.map(foodData), patch.exercises.map((x) => exerciseData(x, day.weight_kg_used)), nowIso);
    });
    return entryResult(deps, profile, existing.id, now);
  });

  app.delete<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const existing = getEntry(deps.db, req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    deleteEntry(deps.db, existing.id);
    const now = deps.now();
    const result: DeleteResult = {
      day: buildDayView(deps.db, profile, existing.date, todayIn(profile.timezone, now), now.toISOString()),
    };
    return result;
  });
}
```

Replace `server/src/routes/index.ts` with:

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { registerDayRoutes } from "./days.ts";
import { registerEntryRoutes } from "./entries.ts";
import { registerHealth } from "./health.ts";
import { registerProfileRoutes } from "./profile.ts";

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerHealth(app);
  registerProfileRoutes(app, deps);
  registerDayRoutes(app, deps);
  registerEntryRoutes(app, deps);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `routes.test.ts` 13 tests pass, everything else still passes; no errors.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): profile, day and entry routes"
```

---

### Task 12: The Claude client and a scriptable fake

**Files:**
- Create: `server/src/ai/client.ts`, `server/src/ai/anthropic.ts`, `server/test/fake-ai.ts`
- Test: `server/test/anthropic.test.ts`

**Interfaces:**
- Produces (`client.ts`): `type AiMessage = Anthropic.Beta.BetaMessageParam`, `type AiContentBlock = Anthropic.Beta.BetaContentBlock`, `type AiTool = Anthropic.Beta.BetaTool`, `type AiErrorCode = "timeout" | "rate_limited" | "api_error"`, `class AiError { code: AiErrorCode }`, `interface AiUsage { input_tokens; output_tokens; cache_read_input_tokens; cache_creation_input_tokens }`, `interface AiRequest { system: string; tools: AiTool[]; messages: AiMessage[] }`, `interface AiResponse { content: AiContentBlock[]; stop_reason: string | null; model: string; usage: AiUsage }`, `interface AiClient { complete(request: AiRequest, signal: AbortSignal): Promise<AiResponse> }`. Nothing outside `src/ai/` imports the SDK at runtime.
- Produces (`anthropic.ts`): `COACH_BETAS`, `buildRequest(model, effort, request): Anthropic.Beta.MessageCreateParamsNonStreaming`, `anthropicClient(opts: { apiKey; model; effort; maxRetries?; fetch? }): AiClient`, `toAiError(err, signal): unknown`.
- Produces (`fake-ai.ts`, tests only): `fakeAi(steps: FakeStep[]): FakeAi` (records `requests`), `textReply(text)`, `toolCall(calls, text?)`, `stopWith("refusal" | "max_tokens")`, `hangUntilAborted()`.

- [ ] **Step 1: Dependency**

```bash
npm install -w server @anthropic-ai/sdk@^0.131.0
```

- [ ] **Step 2: Write the failing test**

`server/test/anthropic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anthropicClient, buildRequest } from "../src/ai/anthropic.ts";
import { AiError } from "../src/ai/client.ts";
import type { AiRequest } from "../src/ai/client.ts";

const request: AiRequest = { system: "You are a coach.", tools: [], messages: [{ role: "user", content: "2 eggs" }] };

function fakeFetch(status: number, body: unknown, seen: { init?: RequestInit; url?: string } = {}) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

const OK_REPLY = {
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
  content: [{ type: "text", text: "Logged.", citations: null }],
  stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: null },
};

describe("buildRequest", () => {
  it("turns on fallbacks, tolerant thinking binding, caching and the chosen effort", () => {
    expect(buildRequest("claude-opus-5-5", "medium", request)).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
      fallbacks: "default",
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: "You are a coach.", cache_control: { type: "ephemeral" } }],
    });
  });
});

describe("anthropicClient", () => {
  it("sends the betas as a header and maps the reply", async () => {
    const seen: { init?: RequestInit; url?: string } = {};
    const client = anthropicClient({ apiKey: "test-key", model: "claude-opus-5-5", effort: "medium", maxRetries: 0, fetch: fakeFetch(200, OK_REPLY, seen) });
    const result = await client.complete(request, new AbortController().signal);
    expect(result).toMatchObject({
      stop_reason: "end_turn",
      model: "claude-opus-5-5",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
    });
    expect(seen.url).toContain("/v1/messages");
    const beta = new Headers(seen.init?.headers).get("anthropic-beta");
    expect(beta).toContain("server-side-fallback-2026-07-01");
    expect(beta).toContain("thinking-binding-controls-2026-08-01");
    expect(JSON.parse(String(seen.init?.body))).toMatchObject({ fallbacks: "default", output_config: { effort: "medium" } });
  });

  it("reports a rate limit as AiError rate_limited", async () => {
    const body = { type: "error", error: { type: "rate_limit_error", message: "slow down" } };
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch: fakeFetch(429, body) });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({ name: "AiError", code: "rate_limited" });
  });

  it("reports other API failures as AiError api_error", async () => {
    const body = { type: "error", error: { type: "api_error", message: "boom" } };
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch: fakeFetch(500, body) });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({ code: "api_error" });
  });

  it("reports an aborted call as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = anthropicClient({ apiKey: "k", model: "m", effort: "medium", maxRetries: 0, fetch: fakeFetch(200, OK_REPLY) });
    const failure = await client.complete(request, controller.signal).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AiError);
    expect(failure).toMatchObject({ code: "timeout" });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/ai/anthropic.ts`.

- [ ] **Step 4: Implement**

`server/src/ai/client.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";

// The coach's view of Claude. Only src/ai/ talks to the SDK; tests swap in a fake.

export type AiMessage = Anthropic.Beta.BetaMessageParam;
export type AiContentBlock = Anthropic.Beta.BetaContentBlock;
export type AiTool = Anthropic.Beta.BetaTool;

export type AiErrorCode = "timeout" | "rate_limited" | "api_error";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface AiRequest {
  system: string;
  tools: AiTool[];
  messages: AiMessage[];
}

export interface AiResponse {
  content: AiContentBlock[];
  stop_reason: string | null;
  model: string;
  usage: AiUsage;
}

export interface AiClient {
  complete(request: AiRequest, signal: AbortSignal): Promise<AiResponse>;
}
```

`server/src/ai/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../config.ts";
import { AiError } from "./client.ts";
import type { AiClient, AiRequest } from "./client.ts";

/**
 * server-side-fallback: a classifier refusal is retried on Anthropic's recommended
 * model inside the same call (spec §6.4).
 * thinking-binding-controls: lets us ask for "drop_block" so a deploy that changes
 * the tools or system prompt mid-day degrades instead of failing with a 400.
 */
export const COACH_BETAS = ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"];

export function buildRequest(model: string, effort: Effort, request: AiRequest): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16000, // thinking counts toward this, so leave room beyond the short reply
    betas: COACH_BETAS,
    fallbacks: "default",
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort },
    cache_control: { type: "ephemeral" }, // caches the growing thread
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    tools: request.tools,
    messages: request.messages,
  };
}

export function toAiError(err: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("timeout", "Claude did not answer in time");
  }
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limited", err.message);
  if (err instanceof Anthropic.APIError) return new AiError("api_error", err.message);
  return err;
}

export function anthropicClient(opts: {
  apiKey: string;
  model: string;
  effort: Effort;
  maxRetries?: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}): AiClient {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 1, timeout: 60_000, fetch: opts.fetch });
  return {
    async complete(request, signal) {
      try {
        const message = await client.beta.messages.create(buildRequest(opts.model, opts.effort, request), { signal });
        return {
          content: message.content,
          stop_reason: message.stop_reason,
          model: message.model,
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: message.usage.output_tokens,
            cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (err) {
        throw toAiError(err, signal);
      }
    },
  };
}
```

`server/test/fake-ai.ts`:

```ts
import { AiError } from "../src/ai/client.ts";
import type { AiClient, AiContentBlock, AiRequest, AiResponse } from "../src/ai/client.ts";

// A scripted stand-in for Claude: each call takes the next step. Tests never touch the network.

export type FakeStep = AiResponse | AiError | ((request: AiRequest, signal: AbortSignal) => AiResponse | Promise<AiResponse>);

export interface FakeAi extends AiClient {
  requests: AiRequest[];
}

export function fakeAi(steps: FakeStep[]): FakeAi {
  const requests: AiRequest[] = [];
  let next = 0;
  return {
    requests,
    async complete(request, signal) {
      requests.push(structuredClone(request));
      const step = steps[next++];
      if (step === undefined) throw new Error(`fakeAi: no scripted response for call ${next}`);
      if (step instanceof AiError) throw step;
      return typeof step === "function" ? step(request, signal) : step;
    },
  };
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let toolIds = 0;

function block(value: Record<string, unknown>): AiContentBlock {
  return value as unknown as AiContentBlock;
}

export function textReply(text: string): AiResponse {
  return { content: [block({ type: "text", text, citations: null })], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
}

export function toolCall(calls: { name: string; input: unknown }[], text = ""): AiResponse {
  const content: AiContentBlock[] = text ? [block({ type: "text", text, citations: null })] : [];
  for (const call of calls) content.push(block({ type: "tool_use", id: `toolu_${++toolIds}`, name: call.name, input: call.input }));
  return { content, stop_reason: "tool_use", model: "claude-opus-5-5", usage };
}

export function stopWith(reason: "refusal" | "max_tokens"): AiResponse {
  return { content: [], stop_reason: reason, model: "claude-opus-5-5", usage };
}

/** A call that only ends when the coach's time budget aborts it. */
export function hangUntilAborted(): FakeStep {
  return (_request, signal) =>
    new Promise<AiResponse>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new AiError("timeout", "aborted")));
    });
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `anthropic.test.ts` 5 tests pass; no errors.

- [ ] **Step 6: Commit**

```bash
git add package-lock.json server
git commit -m "feat(server): Claude client with fallbacks and a scriptable fake"
```

---

### Task 13: Coach tools — strict schemas and staged executors

**Files:**
- Create: `server/src/coach/tools.ts`, `server/src/coach/staging.ts`
- Modify: `server/test/helpers.ts` (add `TOOL_EGGS`, `TOOL_RUN`, `logItemsInput`)
- Test: `server/test/coach-tools.test.ts`

**Interfaces:**
- Consumes: `AiTool` (Task 12), entries persistence (Task 9), `ensureDay` (Task 10), `exerciseKcal` (Task 3), `zonedTimeToInstant` (Task 4), `MAX_BACKDATE_DAYS`, `TIME_HHMM` (shared).
- Produces (`tools.ts`): Zod schemas `LogItemsInput` (`{ date: string | null; time: string | null; foods; exercises }`) and `UpdateEntryInput` (`{ entry_id; foods; exercises }`); types `FoodToolItem`, `ExerciseToolItem`; `strictJsonSchema(schema): Record<string, unknown>`; `COACH_TOOLS: AiTool[]` (`log_items`, `update_entry`, both `strict: true`); `amountIssues(input): string[]`.
- Produces (`staging.ts`): `interface Staging { creates: NewEntry[]; updates: Map<string, { foods; exercises }> }`, `newStaging()`, `interface ToolContext { sql; profile; messageId; messageDate; sentAt: Date; today; weightKg(date): number; staging; newId(): string }`, `interface ToolOutcome { content: string; isError: boolean }`, `executeTool(name, input, ctx): ToolOutcome` (stages, never writes), `applyStaging(sql, staging, profile, nowIso): string[]` (writes; returns the ids it created or changed).
- Produces (`helpers.ts`): `TOOL_EGGS` (a complete food tool item, 180 kcal), `TOOL_RUN` (30 min at MET 9), `logItemsInput(overrides?)`.

- [ ] **Step 1: Test helpers and failing test**

Append to `server/test/helpers.ts`:

```ts
/** A complete food item as Claude sends it to log_items. */
export const TOOL_EGGS = {
  name: "Scrambled eggs", quantity: "2 eggs", grams: 120, kcal: 180, protein_g: 13, carbs_g: 1, fat_g: 14,
  fibre_g: 0, saturated_fat_g: 4, sugars_g: 0.5, salt_g: 0.5, fluid_ml: 0, alcohol_units: 0,
  groups: [], assumption: "cooked with a little butter",
};

/** A complete exercise item as Claude sends it: 30 minutes at MET 9 is 320 active kcal at 80 kg. */
export const TOOL_RUN = {
  name: "Run", category: "cardio", duration_min: 30, met: 9, sets: null, reps: null, weight_kg: null,
  distance_km: 5, muscles: [{ muscle: "quads", role: "primary" }], assumption: "steady pace",
};

export function logItemsInput(overrides: Record<string, unknown> = {}) {
  return { date: null, time: null, foods: [TOOL_EGGS], exercises: [], ...overrides };
}
```

`server/test/coach-tools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDay } from "../src/days/days.ts";
import { getEntry, insertEntry } from "../src/log/entries.ts";
import { applyStaging, executeTool, newStaging } from "../src/coach/staging.ts";
import type { ToolContext } from "../src/coach/staging.ts";
import { COACH_TOOLS, LogItemsInput, strictJsonSchema } from "../src/coach/tools.ts";
import { TOOL_EGGS, TOOL_RUN, logItemsInput, makeProfile, openTestDb, sampleEntry } from "./helpers.ts";

const NOW_ISO = "2026-10-03T12:00:00.000Z";
let db: ReturnType<typeof openTestDb>;
beforeEach(() => {
  db = openTestDb();
});
afterEach(() => db.close());

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  let n = 0;
  return {
    sql: db.db,
    profile: makeProfile(),
    messageId: "msg-1",
    messageDate: "2026-10-03",
    sentAt: new Date("2026-10-03T11:58:00.000Z"),
    today: "2026-10-03",
    weightKg: () => 80,
    staging: newStaging(),
    newId: () => `entry-${++n}`,
    ...overrides,
  };
}

const FORBIDDEN = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "$schema"];

function strictProblems(node: unknown, path: string, problems: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => strictProblems(child, `${path}[${i}]`, problems));
    return problems;
  }
  if (node === null || typeof node !== "object") return problems;
  const obj = node as Record<string, unknown>;
  for (const key of FORBIDDEN) if (key in obj) problems.push(`${path}: ${key}`);
  if (Array.isArray(obj.type)) problems.push(`${path}: type is an array`);
  if (obj.type === "object") {
    if (obj.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`);
    const keys = Object.keys((obj.properties ?? {}) as object).sort();
    const required = [...((obj.required ?? []) as string[])].sort();
    if (keys.join() !== required.join()) problems.push(`${path}: not every property is required`);
  }
  for (const [key, value] of Object.entries(obj)) strictProblems(value, `${path}.${key}`, problems);
  return problems;
}

describe("tool definitions", () => {
  it("are log_items and update_entry, both strict", () => {
    expect(COACH_TOOLS.map((t) => [t.name, t.strict])).toEqual([["log_items", true], ["update_entry", true]]);
  });

  it("use only JSON Schema that strict tool use accepts", () => {
    for (const tool of COACH_TOOLS) expect(strictProblems(tool.input_schema, tool.name)).toEqual([]);
  });

  it("express nullable fields as anyOf", () => {
    const props = (node: unknown) => (node as { properties: Record<string, unknown> }).properties;
    const foods = props(strictJsonSchema(LogItemsInput)).foods as { items: unknown };
    expect(props(foods.items).grams).toMatchObject({ anyOf: [{ type: "number" }, { type: "null" }] });
  });
});

describe("log_items", () => {
  it("stages the entry and works out the exercise calories", () => {
    const ctx = context();
    const outcome = executeTool("log_items", logItemsInput({ exercises: [TOOL_RUN] }), ctx);
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.content)).toEqual({
      ok: true, entry_id: "entry-1", date: "2026-10-03",
      foods: [{ name: "Scrambled eggs", kcal: 180 }], exercises: [{ name: "Run", kcal: 320 }],
    });
    expect(ctx.staging.creates[0]).toMatchObject({ id: "entry-1", source: "coach", message_id: "msg-1", logged_at: "2026-10-03T11:58:00.000Z" });
    expect(ctx.staging.creates[0].exercises[0]).toMatchObject({ kcal: 320, kcal_measured: false, avg_hr: null });
    expect(getEntry(db.db, "entry-1")).toBeNull(); // staged, not written
  });

  it("places a stated time and an earlier date", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput({ date: "2026-10-02", time: "07:30" }), ctx);
    expect(ctx.staging.creates[0]).toMatchObject({ date: "2026-10-02", logged_at: "2026-10-02T06:30:00.000Z" });
  });

  it("puts an earlier day without a time at midday", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput({ date: "2026-10-01" }), ctx);
    expect(ctx.staging.creates[0].logged_at).toBe("2026-10-01T11:00:00.000Z");
  });

  it("refuses future, too-old and malformed dates and times", () => {
    for (const bad of [{ date: "2026-10-04" }, { date: "2026-09-25" }, { date: "2026/10/01" }, { time: "7:30" }]) {
      const outcome = executeTool("log_items", logItemsInput(bad), context());
      expect(outcome.isError).toBe(true);
    }
    expect(executeTool("log_items", logItemsInput({ date: "2026-09-26" }), context()).isError).toBe(false);
  });

  it("refuses negative amounts and empty calls, naming the problem", () => {
    const negative = executeTool("log_items", logItemsInput({ foods: [{ ...TOOL_EGGS, kcal: -5 }] }), context());
    expect(negative.isError).toBe(true);
    expect(negative.content).toContain("foods.0.kcal");
    const empty = executeTool("log_items", logItemsInput({ foods: [] }), context());
    expect(empty.content).toContain("at least one");
  });

  it("reports schema violations with their path", () => {
    const outcome = executeTool("log_items", { date: null, time: null, exercises: [] }, context());
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("foods");
  });
});

describe("update_entry", () => {
  it("changes an entry staged earlier in the same message", () => {
    const ctx = context();
    executeTool("log_items", logItemsInput(), ctx);
    const outcome = executeTool("update_entry", { entry_id: "entry-1", foods: [{ ...TOOL_EGGS, name: "3 scrambled eggs", kcal: 270 }], exercises: [] }, ctx);
    expect(outcome.isError).toBe(false);
    expect(ctx.staging.creates[0].foods[0]).toMatchObject({ name: "3 scrambled eggs", kcal: 270 });
    expect(ctx.staging.updates.size).toBe(0);
  });

  it("stages a change to a stored entry", () => {
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ id: "stored-1" }), NOW_ISO));
    const ctx = context();
    const outcome = executeTool("update_entry", { entry_id: "stored-1", foods: [TOOL_EGGS], exercises: [] }, ctx);
    expect(outcome.isError).toBe(false);
    expect(ctx.staging.updates.get("stored-1")?.foods[0].name).toBe("Scrambled eggs");
  });

  it("refuses unknown ids", () => {
    expect(executeTool("update_entry", { entry_id: "nope", foods: [TOOL_EGGS], exercises: [] }, context()).isError).toBe(true);
  });
});

describe("executeTool and applyStaging", () => {
  it("reject unknown tools", () => {
    expect(executeTool("delete_everything", {}, context()).isError).toBe(true);
  });

  it("write the staged creates and updates and return their ids", () => {
    db.db.transaction((tx) => insertEntry(tx, sampleEntry({ id: "stored-1" }), NOW_ISO));
    const ctx = context();
    executeTool("log_items", logItemsInput(), ctx);
    executeTool("update_entry", { entry_id: "stored-1", foods: [TOOL_EGGS], exercises: [] }, ctx);
    const ids = db.db.transaction((tx) => applyStaging(tx, ctx.staging, ctx.profile, NOW_ISO));
    expect(ids).toEqual(["entry-1", "stored-1"]);
    expect(getEntry(db.db, "entry-1")).toMatchObject({ source: "coach", message_id: "msg-1" });
    expect(getEntry(db.db, "stored-1")).toMatchObject({ edited: true });
    expect(getDay(db.db, "2026-10-03")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/coach/staging.ts`.

- [ ] **Step 3: Implement**

`server/src/coach/tools.ts`:

```ts
import { z } from "zod";
import type { AiTool } from "../ai/client.ts";
import { EXERCISE_CATEGORIES, FOOD_GROUPS, MUSCLES, MUSCLE_ROLES } from "../shared.ts";

// The coach's tool inputs (spec §6.1). Strict tool use needs every property
// required and every object closed, so optional values are nullable instead of
// optional, and range checks live in amountIssues() rather than in the schema.

const FoodToolItem = z.strictObject({
  name: z.string().describe("The food or drink, e.g. 'Porridge with semi-skimmed milk'"),
  quantity: z.string().describe("The portion as eaten, e.g. '1 bowl (250 g)'"),
  grams: z.number().nullable().describe("Weight in grams, known or estimated; null for a drink measured in ml"),
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fibre_g: z.number(),
  saturated_fat_g: z.number(),
  sugars_g: z.number().describe("Total sugars, as on UK labels"),
  salt_g: z.number(),
  fluid_ml: z.number().describe("Volume of a non-alcoholic drink; 0 for food"),
  alcohol_units: z.number().describe("UK alcohol units; 0 if none"),
  groups: z
    .array(z.strictObject({ group: z.enum(FOOD_GROUPS), portions: z.number().describe("Portions of the group; fractions are fine") }))
    .describe("Food-group portions; empty when no group applies"),
  assumption: z.string().describe("What you assumed about the portion or recipe; empty if nothing was assumed"),
});
export type FoodToolItem = z.infer<typeof FoodToolItem>;

const ExerciseToolItem = z.strictObject({
  name: z.string().describe("The activity, e.g. 'Barbell bench press' or 'Outdoor run'"),
  category: z.enum(EXERCISE_CATEGORIES),
  duration_min: z.number().describe("Minutes, including rest between sets; estimate it when not stated"),
  met: z.number().describe("MET value of the activity at the intensity described"),
  sets: z.number().nullable(),
  reps: z.number().nullable(),
  weight_kg: z.number().nullable(),
  distance_km: z.number().nullable(),
  muscles: z
    .array(z.strictObject({ muscle: z.enum(MUSCLES), role: z.enum(MUSCLE_ROLES) }))
    .describe("Muscles worked; empty when the activity has no clear muscle focus"),
  assumption: z.string().describe("What you assumed, e.g. pace or rest time; empty if nothing"),
});
export type ExerciseToolItem = z.infer<typeof ExerciseToolItem>;

export const LogItemsInput = z.strictObject({
  date: z.string().nullable().describe("YYYY-MM-DD when it happened on an earlier day than the message; otherwise null"),
  time: z.string().nullable().describe("Local time HH:MM when it was stated; otherwise null"),
  foods: z.array(FoodToolItem),
  exercises: z.array(ExerciseToolItem),
});
export type LogItemsInput = z.infer<typeof LogItemsInput>;

export const UpdateEntryInput = z.strictObject({
  entry_id: z.string().describe("The id of the entry to correct, from the context block"),
  foods: z.array(FoodToolItem).describe("The entry's complete corrected food list, including unchanged items"),
  exercises: z.array(ExerciseToolItem).describe("The entry's complete corrected exercise list, including unchanged items"),
});
export type UpdateEntryInput = z.infer<typeof UpdateEntryInput>;

/** Rewrites `type: [X, "null"]` as anyOf, a form strict tool use documents as supported. */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = normalize(value);
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const description = out.description;
    delete out.type;
    delete out.description;
    const anyOf = types.map((type) => (type === "null" ? { type: "null" } : { ...out, type }));
    return description === undefined ? { anyOf } : { description, anyOf };
  }
  return out;
}

export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return normalize(json) as Record<string, unknown>;
}

export const COACH_TOOLS: AiTool[] = [
  {
    name: "log_items",
    description:
      "Record food, drink and/or exercise that the person states they had or did. Call it once per message with every item from that message. Never use it for questions or hypotheticals.",
    strict: true,
    input_schema: strictJsonSchema(LogItemsInput) as AiTool["input_schema"],
  },
  {
    name: "update_entry",
    description:
      "Correct an entry that is already logged by replacing all of its items. Send the complete corrected list, including the items that did not change.",
    strict: true,
    input_schema: strictJsonSchema(UpdateEntryInput) as AiTool["input_schema"],
  },
];

const FOOD_AMOUNTS = [
  "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g",
  "saturated_fat_g", "sugars_g", "salt_g", "fluid_ml", "alcohol_units",
] as const;
const EXERCISE_OPTIONALS = ["sets", "reps", "weight_kg", "distance_km"] as const;

/** Range checks the schema cannot express under strict tool use. */
export function amountIssues(input: { foods: FoodToolItem[]; exercises: ExerciseToolItem[] }): string[] {
  const issues: string[] = [];
  if (input.foods.length + input.exercises.length === 0) issues.push("at least one food or exercise is required");
  input.foods.forEach((food, i) => {
    for (const key of FOOD_AMOUNTS) if (food[key] < 0) issues.push(`foods.${i}.${key} must not be negative`);
    if (food.grams !== null && food.grams <= 0) issues.push(`foods.${i}.grams must be positive or null`);
    food.groups.forEach((g, j) => {
      if (g.portions <= 0) issues.push(`foods.${i}.groups.${j}.portions must be positive`);
    });
  });
  input.exercises.forEach((item, i) => {
    if (item.duration_min <= 0) issues.push(`exercises.${i}.duration_min must be positive`);
    if (item.met < 1) issues.push(`exercises.${i}.met must be at least 1`);
    for (const key of EXERCISE_OPTIONALS) {
      const value = item[key];
      if (value !== null && value <= 0) issues.push(`exercises.${i}.${key} must be positive or null`);
    }
  });
  return issues;
}
```

`server/src/coach/staging.ts`:

```ts
import type { z } from "zod";
import { ensureDay } from "../days/days.ts";
import type { Sql } from "../db/types.ts";
import { getEntry, insertEntry, replaceEntryItems } from "../log/entries.ts";
import type { ExerciseItemData, FoodItemData, NewEntry } from "../log/entries.ts";
import { MAX_BACKDATE_DAYS, TIME_HHMM, daysBetween, isIsoDate } from "../shared.ts";
import type { Profile } from "../shared.ts";
import { exerciseKcal } from "../targets/targets.ts";
import { zonedTimeToInstant } from "../time.ts";
import { LogItemsInput, UpdateEntryInput, amountIssues } from "./tools.ts";
import type { ExerciseToolItem, FoodToolItem } from "./tools.ts";

// Tool calls are validated and STAGED here; nothing touches the database until
// the whole coach loop succeeds and applyStaging() runs in the final transaction.

export interface Staging {
  creates: NewEntry[];
  updates: Map<string, { foods: FoodItemData[]; exercises: ExerciseItemData[] }>;
}

export function newStaging(): Staging {
  return { creates: [], updates: new Map() };
}

export interface ToolContext {
  sql: Sql;
  profile: Profile;
  messageId: string;
  /** The day the message belongs to. */
  messageDate: string;
  sentAt: Date;
  today: string;
  /** The weight frozen in that day's snapshot, for exercise calories. */
  weightKg: (date: string) => number;
  staging: Staging;
  newId: () => string;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

const ok = (value: Record<string, unknown>): ToolOutcome => ({ content: JSON.stringify({ ok: true, ...value }), isError: false });
const fail = (message: string): ToolOutcome => ({ content: JSON.stringify({ ok: false, error: message }), isError: true });

function zodFailure(error: z.ZodError): ToolOutcome {
  return fail(error.issues.map((issue) => `${issue.path.map(String).join(".") || "input"}: ${issue.message}`).join("; "));
}

function foodFromTool(food: FoodToolItem): FoodItemData {
  return { ...food, saved_food_id: null };
}

function exerciseFromTool(item: ExerciseToolItem, weightKg: number): ExerciseItemData {
  return { ...item, avg_hr: null, kcal: exerciseKcal(item.met, weightKg, item.duration_min), kcal_measured: false };
}

function summary(id: string, date: string, foods: FoodItemData[], exercises: ExerciseItemData[]) {
  return {
    entry_id: id,
    date,
    foods: foods.map((f) => ({ name: f.name, kcal: Math.round(f.kcal) })),
    exercises: exercises.map((x) => ({ name: x.name, kcal: Math.round(x.kcal) })),
  };
}

function logItems(raw: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = LogItemsInput.safeParse(raw);
  if (!parsed.success) return zodFailure(parsed.error);
  const input = parsed.data;
  const date = input.date ?? ctx.messageDate;
  if (!isIsoDate(date)) return fail(`date must be YYYY-MM-DD, got "${date}"`);
  if (date > ctx.today) return fail("date is in the future");
  if (daysBetween(date, ctx.today) > MAX_BACKDATE_DAYS) return fail(`date is more than ${MAX_BACKDATE_DAYS} days ago`);
  if (input.time !== null && !TIME_HHMM.test(input.time)) return fail(`time must be HH:MM, got "${input.time}"`);
  const issues = amountIssues(input);
  if (issues.length > 0) return fail(issues.join("; "));

  const timeZone = ctx.profile.timezone;
  const loggedAt =
    input.time !== null ? zonedTimeToInstant(date, input.time, timeZone)
    : date === ctx.messageDate ? ctx.sentAt
    : zonedTimeToInstant(date, "12:00", timeZone);
  const weight = ctx.weightKg(date);
  const entry: NewEntry = {
    id: ctx.newId(),
    date,
    logged_at: loggedAt.toISOString(),
    source: "coach",
    message_id: ctx.messageId,
    foods: input.foods.map(foodFromTool),
    exercises: input.exercises.map((item) => exerciseFromTool(item, weight)),
  };
  ctx.staging.creates.push(entry);
  return ok(summary(entry.id, date, entry.foods, entry.exercises));
}

function updateEntry(raw: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = UpdateEntryInput.safeParse(raw);
  if (!parsed.success) return zodFailure(parsed.error);
  const input = parsed.data;
  const issues = amountIssues(input);
  if (issues.length > 0) return fail(issues.join("; "));

  const staged = ctx.staging.creates.find((e) => e.id === input.entry_id);
  if (staged) {
    const weight = ctx.weightKg(staged.date);
    staged.foods = input.foods.map(foodFromTool);
    staged.exercises = input.exercises.map((item) => exerciseFromTool(item, weight));
    return ok(summary(staged.id, staged.date, staged.foods, staged.exercises));
  }

  const existing = getEntry(ctx.sql, input.entry_id);
  if (!existing) return fail(`there is no entry with id ${input.entry_id}`);
  if (daysBetween(existing.date, ctx.today) > MAX_BACKDATE_DAYS) {
    return fail(`entries older than ${MAX_BACKDATE_DAYS} days can't be changed here`);
  }
  const weight = ctx.weightKg(existing.date);
  const foods = input.foods.map(foodFromTool);
  const exercises = input.exercises.map((item) => exerciseFromTool(item, weight));
  ctx.staging.updates.set(existing.id, { foods, exercises });
  return ok(summary(existing.id, existing.date, foods, exercises));
}

export function executeTool(name: string, input: unknown, ctx: ToolContext): ToolOutcome {
  if (name === "log_items") return logItems(input, ctx);
  if (name === "update_entry") return updateEntry(input, ctx);
  return fail(`unknown tool ${name}`);
}

/** Writes everything staged. Run inside the message's final transaction. */
export function applyStaging(sql: Sql, staging: Staging, profile: Profile, nowIso: string): string[] {
  for (const entry of staging.creates) {
    ensureDay(sql, profile, entry.date, nowIso);
    insertEntry(sql, entry, nowIso);
  }
  for (const [id, items] of staging.updates) replaceEntryItems(sql, id, items.foods, items.exercises, nowIso);
  return [...staging.creates.map((e) => e.id), ...staging.updates.keys()];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `coach-tools.test.ts` 14 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(coach): strict tool schemas and staged executors"
```

---

### Task 14: Coach prompt and the day's thread

**Files:**
- Create: `server/src/coach/prompt.ts`, `server/src/coach/thread.ts`
- Test: `server/test/coach-context.test.ts`

**Interfaces:**
- Consumes: `ageOn` (Task 3), time helpers (Task 4), `DayView` (shared), `AiMessage` (Task 12), tables (Task 5).
- Produces (`prompt.ts`): `COACH_INSTRUCTIONS: string`, `buildSystemPrompt(profile: Profile, date: string): string`, `buildTurnContext(view: DayView, now: Date, timeZone: string): string` (starts with `Context for this message (JSON):` then one line of JSON with `now_local`, `weekday`, `message_date`, `targets`, `eaten_so_far`, `exercise_kcal`, `entries[]` — each entry has its `id`, local `time`, `source`, and full `foods`/`exercises`).
- Produces (`thread.ts`): `getOrCreateThread(sql, date, build: () => string, nowIso): string` (frozen after the first call for that date), `loadTurns(sql, date): AiMessage[]`, `appendTurns(sql, date, messageId, turns: AiMessage[], nowIso): void`.

- [ ] **Step 1: Write the failing test**

`server/test/coach-context.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiMessage } from "../src/ai/client.ts";
import { buildSystemPrompt, buildTurnContext } from "../src/coach/prompt.ts";
import { appendTurns, getOrCreateThread, loadTurns } from "../src/coach/thread.ts";
import { buildDayView, ensureDay } from "../src/days/days.ts";
import { insertEntry } from "../src/log/entries.ts";
import { makeProfile, openTestDb, sampleEntry, sampleFood } from "./helpers.ts";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
let db: ReturnType<typeof openTestDb>;
beforeEach(() => {
  db = openTestDb();
});
afterEach(() => db.close());

describe("buildSystemPrompt", () => {
  it("states the logging rules and who the person is", () => {
    const prompt = buildSystemPrompt(makeProfile(), "2026-10-03");
    expect(prompt).toContain("log_items");
    expect(prompt).toContain("update_entry");
    expect(prompt).toContain("do not log anything");
    expect(prompt).toContain("male, 35 years, 180 cm, 80 kg");
    expect(prompt).toContain("lose 0.5 kg a week");
    expect(prompt).toContain("Europe/London");
  });
});

describe("buildTurnContext", () => {
  it("gives the time, targets, totals and every entry with its id", () => {
    const profile = makeProfile();
    ensureDay(db.db, profile, "2026-10-03", NOW_ISO);
    const entry = sampleEntry({ logged_at: "2026-10-03T07:10:00.000Z", foods: [sampleFood({ kcal: 156.4 })] });
    db.db.transaction((tx) => insertEntry(tx, entry, NOW_ISO));
    const text = buildTurnContext(buildDayView(db.db, profile, "2026-10-03", "2026-10-03", NOW_ISO), NOW, "Europe/London");

    const [heading, json] = text.split("\n");
    expect(heading).toBe("Context for this message (JSON):");
    const context = JSON.parse(json);
    expect(context).toMatchObject({ now_local: "2026-10-03 13:00", weekday: "Saturday", message_date: "2026-10-03", exercise_kcal: 0 });
    expect(context.targets.kcal).toBe(1863.1);
    expect(context.eaten_so_far.kcal).toBe(156.4);
    expect(context.entries[0]).toMatchObject({ id: entry.id, time: "08:10", source: "manual" });
    expect(context.entries[0].foods[0]).toMatchObject({ name: "Eggs", quantity: "2 large", kcal: 156.4, groups: [] });
    expect(context.entries[0].foods[0]).not.toHaveProperty("id");
  });
});

describe("the day's thread", () => {
  it("freezes the system prompt at the first message of the day", () => {
    const build = vi.fn(() => "system v1");
    expect(getOrCreateThread(db.db, "2026-10-03", build, NOW_ISO)).toBe("system v1");
    expect(getOrCreateThread(db.db, "2026-10-03", () => "system v2", NOW_ISO)).toBe("system v1");
    expect(build).toHaveBeenCalledTimes(1);
    expect(getOrCreateThread(db.db, "2026-10-04", () => "next day", NOW_ISO)).toBe("next day");
  });

  it("replays the day's turns exactly and in order", () => {
    const first: AiMessage[] = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ];
    const second: AiMessage[] = [{ role: "user", content: [{ type: "text", text: "c" }] }];
    appendTurns(db.db, "2026-10-03", "m1", first, NOW_ISO);
    appendTurns(db.db, "2026-10-03", "m2", second, NOW_ISO);
    appendTurns(db.db, "2026-10-04", "m3", [{ role: "user", content: [{ type: "text", text: "other day" }] }], NOW_ISO);
    expect(loadTurns(db.db, "2026-10-03")).toEqual([...first, ...second]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/coach/prompt.ts`.

- [ ] **Step 3: Implement**

`server/src/coach/prompt.ts`:

```ts
import type { DayView, Profile } from "../shared.ts";
import { ageOn } from "../targets/targets.ts";
import { localDate, localTime, weekdayName } from "../time.ts";

// The day's system prompt is built once at its first message and then frozen
// (spec §6.2); everything that changes during the day rides in each user turn.

export const COACH_INSTRUCTIONS = `You are the coach inside fitnessAI, a personal food and training logbook that one person uses on their phone. Messages are short, often dictated, and may contain dictation mistakes.

Each new message from the person starts with a context block (JSON) describing their day so far, including the id of every entry. Treat it as the current state of the log.

What to do with a message:
- When they state as a fact something they ate, drank or did ("I had…", "just ran…", "lunch was…"), call log_items once with every item in that message. Log straight away; do not ask for confirmation. If a portion or recipe is vague, choose a typical one and say what you assumed in that item's assumption field.
- When they correct something already logged ("actually it was 2 eggs"), call update_entry with that entry's complete corrected list of items, including the items that did not change.
- When they ask a question or describe something hypothetical ("should I…", "what if I…", "is X healthy?"), answer briefly and do not log anything.
- If you cannot tell whether something actually happened, ask one short question instead of logging.

Estimating food and drink:
- Give realistic values for the item as eaten: kcal, protein, carbs, fat, fibre, saturated fat, sugars (total sugars, as on UK labels), salt, fluid_ml (the volume of a non-alcoholic drink; 0 for food) and alcohol_units (UK units; 0 if none).
- Tag food groups with portions: vegetables 80 g, fruit 80 g (30 g dried), legumes 80 g cooked, wholegrains one serving (e.g. 40 g oats or one slice of wholemeal bread), nuts_seeds 30 g, oily_fish 140 g, red_meat 70 g cooked, processed_meat 70 g, ultra_processed one item or serving, sugary_drinks 330 ml, fried_food one serving. Fractions are fine. Use an empty list when no group applies.

Estimating exercise:
- Give the MET value of the activity at the intensity described and its duration in minutes. If only sets are given, estimate the duration including rest. The app calculates the calories from these and the person's weight.
- List the muscles worked from the allowed list, marking each primary or secondary. Record sets, reps, weight and distance when they are stated.

Dates and times:
- Leave date and time null for something that just happened. If they say when it happened ("yesterday", "this morning at 7"), set the date (YYYY-MM-DD) and/or the local time (HH:MM). The date can be at most 7 days back.

Replying:
- Keep replies short: one or two sentences confirming what you logged and its calories, or a brief answer. The person reads on a phone.
- Use metric units.
- Give general nutrition and training information, never medical advice or a diagnosis.`;

function goalText(profile: Profile): string {
  return profile.goal === "maintain" ? "maintain weight" : `${profile.goal} ${profile.goal_rate_kg_week} kg a week`;
}

export function buildSystemPrompt(profile: Profile, date: string): string {
  const about = [
    `About the person (as of ${date}):`,
    `- ${profile.sex}, ${ageOn(profile.birth_date, date)} years, ${profile.height_cm} cm, ${profile.weight_kg} kg`,
    `- Body goal: ${goalText(profile)}`,
    `- Everyday activity, excluding workouts: ${profile.activity_level}`,
    `- Timezone: ${profile.timezone}`,
  ].join("\n");
  return `${COACH_INSTRUCTIONS}\n\n${about}`;
}

/** Rounds every numeric field of a flat object to one decimal place. */
function rounded<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, typeof v === "number" ? Math.round(v * 10) / 10 : v]),
  ) as T;
}

export function buildTurnContext(view: DayView, now: Date, timeZone: string): string {
  const context = {
    now_local: `${localDate(now, timeZone)} ${localTime(now, timeZone)}`,
    weekday: weekdayName(now, timeZone),
    message_date: view.date,
    targets: rounded(view.targets.adjusted),
    eaten_so_far: rounded(view.totals),
    exercise_kcal: Math.round(view.targets.workout_kcal),
    entries: view.entries.map((entry) => ({
      id: entry.id,
      time: localTime(new Date(entry.logged_at), timeZone),
      source: entry.source,
      foods: entry.foods.map(({ id: _id, position: _position, saved_food_id: _saved, ...food }) => rounded(food)),
      exercises: entry.exercises.map(({ id: _id, position: _position, kcal_measured: _measured, avg_hr: _hr, ...item }) => rounded(item)),
    })),
  };
  return `Context for this message (JSON):\n${JSON.stringify(context)}`;
}
```

`server/src/coach/thread.ts`:

```ts
import { asc, eq, max } from "drizzle-orm";
import type { AiMessage } from "../ai/client.ts";
import { coachThreads, coachTurns } from "../db/schema.ts";
import type { Sql } from "../db/types.ts";

// One thread per day. Its system prompt is frozen at the first message and its
// turns are only ever appended: current Claude models reject a history whose
// earlier turns changed, and an unchanged prefix keeps the prompt cache warm.

export function getOrCreateThread(sql: Sql, date: string, build: () => string, nowIso: string): string {
  const existing = sql.select().from(coachThreads).where(eq(coachThreads.date, date)).get();
  if (existing) return existing.system;
  const system = build();
  sql.insert(coachThreads).values({ date, system, created_at: nowIso }).run();
  return system;
}

export function loadTurns(sql: Sql, date: string): AiMessage[] {
  return sql
    .select()
    .from(coachTurns)
    .where(eq(coachTurns.date, date))
    .orderBy(asc(coachTurns.seq))
    .all()
    .map((row) => ({ role: row.role as AiMessage["role"], content: row.blocks as AiMessage["content"] }));
}

export function appendTurns(sql: Sql, date: string, messageId: string, turns: AiMessage[], nowIso: string): void {
  const last = sql.select({ seq: max(coachTurns.seq) }).from(coachTurns).where(eq(coachTurns.date, date)).get();
  let seq = (last?.seq ?? -1) + 1;
  for (const turn of turns) {
    const blocks = typeof turn.content === "string" ? [{ type: "text", text: turn.content }] : turn.content;
    sql.insert(coachTurns).values({ date, seq: seq++, role: turn.role, blocks, message_id: messageId, created_at: nowIso }).run();
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `coach-context.test.ts` 4 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(coach): system prompt, per-turn context and the day's thread"
```

---

### Task 15: The coach's tool loop

**Files:**
- Create: `server/src/coach/loop.ts`
- Test: `server/test/coach-loop.test.ts`

**Interfaces:**
- Consumes: `AiClient`, `AiError`, `AiMessage`, `AiTool`, `AiUsage` (Task 12); `ToolOutcome` (Task 13).
- Produces: `type CoachFailure = "timeout" | "ai_error" | "ai_rate_limited" | "refused" | "max_tokens" | "tool_loop_limit"`, `interface LoopInput { ai; system; tools; history: AiMessage[]; userTurn: AiMessage; execute(name, input): ToolOutcome; signal: AbortSignal; maxCalls: number }`, `type LoopResult = { ok: true; turns: AiMessage[]; replyText: string; calls: number; usage: AiUsage } | { ok: false; failure: CoachFailure; calls: number; usage: AiUsage }`, `runCoachLoop(input): Promise<LoopResult>`. `turns` starts with `userTurn` and holds every turn to append to the thread. Errors that are not `AiError` are rethrown.

- [ ] **Step 1: Write the failing test**

`server/test/coach-loop.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AiError } from "../src/ai/client.ts";
import type { AiClient, AiMessage } from "../src/ai/client.ts";
import { runCoachLoop } from "../src/coach/loop.ts";
import type { LoopInput } from "../src/coach/loop.ts";
import { fakeAi, stopWith, textReply, toolCall } from "./fake-ai.ts";

const userTurn: AiMessage = { role: "user", content: [{ type: "text", text: "2 eggs" }] };
const okOutcome = () => ({ content: '{"ok":true}', isError: false });

function input(ai: AiClient, overrides: Partial<LoopInput> = {}): LoopInput {
  return {
    ai, system: "system", tools: [], history: [], userTurn, execute: vi.fn(okOutcome),
    signal: new AbortController().signal, maxCalls: 5, ...overrides,
  };
}

describe("runCoachLoop", () => {
  it("returns the reply when Claude answers without tools", async () => {
    const result = await runCoachLoop(input(fakeAi([textReply("Hello")])));
    expect(result).toMatchObject({ ok: true, replyText: "Hello", calls: 1 });
    expect(result.ok && result.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("runs the tools Claude asks for and sends the results back", async () => {
    const ai = fakeAi([toolCall([{ name: "log_items", input: { a: 1 } }]), textReply("Logged.")]);
    const execute = vi.fn(okOutcome);
    const result = await runCoachLoop(input(ai, { execute }));
    expect(execute).toHaveBeenCalledWith("log_items", { a: 1 });
    expect(result).toMatchObject({ ok: true, replyText: "Logged.", calls: 2 });
    expect(result.ok && result.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(ai.requests[1].messages[2]).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", content: '{"ok":true}', is_error: false }],
    });
  });

  it("passes tool errors back so Claude can correct itself", async () => {
    const ai = fakeAi([toolCall([{ name: "log_items", input: {} }]), textReply("Fixed.")]);
    await runCoachLoop(input(ai, { execute: () => ({ content: '{"ok":false}', isError: true }) }));
    expect(ai.requests[1].messages[2]).toMatchObject({ content: [{ type: "tool_result", is_error: true }] });
  });

  it("sends the day's history before the new turn", async () => {
    const history: AiMessage[] = [
      { role: "user", content: [{ type: "text", text: "earlier" }] },
      { role: "assistant", content: [{ type: "text", text: "noted" }] },
    ];
    const ai = fakeAi([textReply("Hi")]);
    await runCoachLoop(input(ai, { history }));
    expect(ai.requests[0].messages).toEqual([...history, userTurn]);
  });

  it("stops on a refusal or a cut-off reply", async () => {
    expect(await runCoachLoop(input(fakeAi([stopWith("refusal")])))).toMatchObject({ ok: false, failure: "refused" });
    expect(await runCoachLoop(input(fakeAi([stopWith("max_tokens")])))).toMatchObject({ ok: false, failure: "max_tokens" });
  });

  it("maps AI errors to failures", async () => {
    expect(await runCoachLoop(input(fakeAi([new AiError("timeout", "slow")])))).toMatchObject({ ok: false, failure: "timeout" });
    expect(await runCoachLoop(input(fakeAi([new AiError("rate_limited", "busy")])))).toMatchObject({ ok: false, failure: "ai_rate_limited" });
    expect(await runCoachLoop(input(fakeAi([new AiError("api_error", "boom")])))).toMatchObject({ ok: false, failure: "ai_error" });
  });

  it("gives up after the call limit", async () => {
    const loop = () => toolCall([{ name: "log_items", input: {} }]);
    const result = await runCoachLoop(input(fakeAi([loop(), loop(), loop()]), { maxCalls: 3 }));
    expect(result).toMatchObject({ ok: false, failure: "tool_loop_limit", calls: 3 });
  });

  it("adds up token usage across calls", async () => {
    const result = await runCoachLoop(input(fakeAi([toolCall([{ name: "log_items", input: {} }]), textReply("ok")])));
    expect(result.usage).toMatchObject({ input_tokens: 200, output_tokens: 40 });
  });

  it("rethrows unexpected errors instead of hiding bugs", async () => {
    const ai = fakeAi([() => {
      throw new Error("bug");
    }]);
    await expect(runCoachLoop(input(ai))).rejects.toThrow("bug");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/coach/loop.ts`.

- [ ] **Step 3: Implement**

`server/src/coach/loop.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../ai/client.ts";
import type { AiClient, AiMessage, AiResponse, AiTool, AiUsage } from "../ai/client.ts";
import type { ToolOutcome } from "./staging.ts";

export type CoachFailure = "timeout" | "ai_error" | "ai_rate_limited" | "refused" | "max_tokens" | "tool_loop_limit";

export interface LoopInput {
  ai: AiClient;
  system: string;
  tools: AiTool[];
  /** Earlier turns of the day, replayed unchanged. */
  history: AiMessage[];
  userTurn: AiMessage;
  execute: (name: string, input: unknown) => ToolOutcome;
  signal: AbortSignal;
  maxCalls: number;
}

export type LoopResult =
  | { ok: true; turns: AiMessage[]; replyText: string; calls: number; usage: AiUsage }
  | { ok: false; failure: CoachFailure; calls: number; usage: AiUsage };

function failureFor(err: AiError): CoachFailure {
  if (err.code === "timeout") return "timeout";
  if (err.code === "rate_limited") return "ai_rate_limited";
  return "ai_error";
}

export async function runCoachLoop(input: LoopInput): Promise<LoopResult> {
  const turns: AiMessage[] = [input.userTurn];
  const usage: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const texts: string[] = [];
  let calls = 0;

  while (calls < input.maxCalls) {
    calls += 1;
    let response: AiResponse;
    try {
      response = await input.ai.complete(
        { system: input.system, tools: input.tools, messages: [...input.history, ...turns] },
        input.signal,
      );
    } catch (err) {
      if (err instanceof AiError) return { ok: false, failure: failureFor(err), calls, usage };
      throw err;
    }
    for (const key of Object.keys(usage) as (keyof AiUsage)[]) usage[key] += response.usage[key];

    // A refusal can cut a tool call off mid-input: never run that turn's tools.
    if (response.stop_reason === "refusal") return { ok: false, failure: "refused", calls, usage };
    if (response.stop_reason === "max_tokens") return { ok: false, failure: "max_tokens", calls, usage };

    // Echo the content back exactly as it came: thinking blocks must be replayed unchanged.
    turns.push({ role: "assistant", content: response.content });
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) texts.push(block.text.trim());
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) return { ok: true, turns, replyText: texts.join("\n\n"), calls, usage };

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      const outcome = input.execute(use.name, use.input);
      return { type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
    });
    turns.push({ role: "user", content: results });
  }
  return { ok: false, failure: "tool_loop_limit", calls, usage };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `coach-loop.test.ts` 9 tests pass; no errors.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(coach): tool loop with refusal, cut-off and call-limit handling"
```

---

### Task 16: Processing messages, and the message routes

**Files:**
- Create: `server/src/coach/process.ts`, `server/src/routes/messages.ts`
- Modify: `server/src/messages/messages.ts`, `server/src/deps.ts`, `server/src/routes/index.ts`, `server/test/helpers.ts`
- Test: `server/test/messages.test.ts`

**Interfaces:**
- Consumes: Tasks 10, 12–15.
- Produces (`messages.ts`, added): `getMessage(sql, id): MessageRow | null`, `getReply(sql, userMessageId): MessageRow | null`, `insertUserMessage(sql, { id, date, text, sentAt, nowIso })` (status `pending`), `setMessageStatus(sql, id, status, errorCode)`, `insertReply(sql, { id, replyTo, date, text, cards, nowIso })`, `failInterrupted(sql): number` (pending → `failed`/`interrupted`).
- Produces (`process.ts`): `MAX_MODEL_CALLS = 5`, `interface CoachDeps { db; ai: AiClient | null; now; budgetMs; newId? }`, `type ProcessOutcomeCode = "done" | CoachFailure | "ai_unavailable" | "no_profile"`, `interface ProcessOutcome { outcome; calls; usage: AiUsage | null }`, `processMessage(deps, messageId): Promise<ProcessOutcome>`.
- Produces (`deps.ts`): `AppDeps` gains `ai: AiClient | null` and `coachBudgetMs: number`.
- Produces (routes): `POST /api/messages` (`MessageInput`) → 201 `MessageResult` (200 with the stored result for a repeated id; 409 `in_progress` while pending; 400 `future_date`/`too_old`); `POST /api/messages/:id/retry` → `MessageResult` | 404 | 409 `not_failed`.
- Produces (`helpers.ts`): `testApp` accepts `ai?: AiClient | null` and `coachBudgetMs?: number`.

- [ ] **Step 1: Extend the dependencies and the test app**

In `server/src/deps.ts`, add the import and two fields:

```ts
import type { AiClient } from "./ai/client.ts";
```

```ts
  /** Null when ANTHROPIC_API_KEY is unset: the coach is off, manual logging still works. */
  ai: AiClient | null;
  /** Total time one coach message may take; under Cloudflare's 100 s proxy timeout. */
  coachBudgetMs: number;
```

In `server/test/helpers.ts`, replace `testApp` with:

```ts
import type { AiClient } from "../src/ai/client.ts";

export async function testApp(opts: { now?: Date; webDist?: string | null; ai?: AiClient | null; coachBudgetMs?: number } = {}) {
  const auth = await makeAccess();
  const database = openTestDb();
  const app = buildApp({
    db: database.db,
    verifier: auth.verifier,
    now: () => opts.now ?? NOW,
    webDist: opts.webDist ?? null,
    ai: opts.ai ?? null,
    coachBudgetMs: opts.coachBudgetMs ?? 90_000,
  });
  await app.ready();
  const owner = await auth.token();
  return {
    app,
    db: database.db,
    auth,
    headers: { "cf-access-jwt-assertion": owner },
    close: async () => {
      await app.close();
      database.close();
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

`server/test/messages.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AiError } from "../src/ai/client.ts";
import { coachTurns } from "../src/db/schema.ts";
import { failInterrupted, getMessage, insertUserMessage } from "../src/messages/messages.ts";
import { saveProfile } from "../src/profile/profile.ts";
import { fakeAi, hangUntilAborted, textReply, toolCall } from "./fake-ai.ts";
import type { FakeStep } from "./fake-ai.ts";
import { NOW, TOOL_EGGS, logItemsInput, makeProfile, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function appWith(steps: FakeStep[] | null, coachBudgetMs?: number) {
  const ai = steps ? fakeAi(steps) : null;
  ctx = await testApp({ ai, coachBudgetMs });
  saveProfile(ctx.db, makeProfile(), NOW.toISOString());
  return { app: ctx, ai };
}

function send(app: TestApp, text: string, id = randomUUID(), sentAt = "2026-10-03T11:58:00.000Z") {
  return app.app.inject({ method: "POST", url: "/api/messages", headers: app.headers, payload: { id, sent_at: sentAt, text } });
}

function retry(app: TestApp, id: string) {
  return app.app.inject({ method: "POST", url: `/api/messages/${id}/retry`, headers: app.headers });
}

describe("POST /api/messages", () => {
  it("logs what the coach records and returns the reply with the day", async () => {
    const { app, ai } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged 2 scrambled eggs, 180 kcal.")]);
    const res = await send(app, "2 scrambled eggs");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ role: "user", status: "done", date: "2026-10-03", error_code: null });
    expect(body.reply).toMatchObject({ role: "assistant", text: "Logged 2 scrambled eggs, 180 kcal.", reply_to: body.user.id });
    expect(body.day.entries).toHaveLength(1);
    expect(body.day.entries[0]).toMatchObject({ source: "coach", message_id: body.user.id });
    expect(body.reply.cards).toEqual([{ type: "entry", id: body.day.entries[0].id }]);
    expect(body.day.totals.kcal).toBe(180);
    expect(ai?.requests[0].tools.map((t) => t.name)).toEqual(["log_items", "update_entry"]);
    expect(JSON.stringify(ai?.requests[0].messages[0])).toContain("Context for this message");
  });

  it("returns the stored result for a repeated id without asking the coach again", async () => {
    const { app, ai } = await appWith([textReply("Hi!")]);
    const id = randomUUID();
    await send(app, "hello", id);
    const again = await send(app, "hello", id);
    expect(again.statusCode).toBe(200);
    expect(again.json().reply.text).toBe("Hi!");
    expect(ai?.requests).toHaveLength(1);
  });

  it("reports a message that is still being processed", async () => {
    const { app } = await appWith([]);
    const id = randomUUID();
    insertUserMessage(app.db, { id, date: "2026-10-03", text: "x", sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    const res = await send(app, "x", id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "in_progress" });
  });

  it("leaves only a failed message when the coach fails, and Retry logs exactly once", async () => {
    const { app } = await appWith([
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      new AiError("api_error", "boom"),
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
    ]);
    const first = await send(app, "2 scrambled eggs");
    expect(first.json().user).toMatchObject({ status: "failed", error_code: "ai_error" });
    expect(first.json().reply).toBeNull();
    expect(first.json().day.entries).toEqual([]);
    expect(app.db.select().from(coachTurns).all()).toEqual([]);

    const retried = await retry(app, first.json().user.id);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().user.status).toBe("done");
    expect(retried.json().day.entries).toHaveLength(1);
  });

  it("fails with ai_unavailable when no API key is configured", async () => {
    const { app } = await appWith(null);
    expect((await send(app, "2 eggs")).json().user).toMatchObject({ status: "failed", error_code: "ai_unavailable" });
  });

  it("fails with timeout when the coach exceeds its budget", async () => {
    const { app } = await appWith([hangUntilAborted()], 50);
    expect((await send(app, "2 eggs")).json().user).toMatchObject({ status: "failed", error_code: "timeout" });
  });

  it("carries the day's conversation forward under the same frozen system prompt", async () => {
    const { app, ai } = await appWith([
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
      textReply("About 1,680 kcal left."),
    ]);
    await send(app, "2 scrambled eggs");
    await send(app, "how much is left?", randomUUID(), "2026-10-03T11:59:00.000Z");
    expect(ai?.requests).toHaveLength(3);
    expect(ai?.requests[2].system).toBe(ai?.requests[0].system);
    // user, tool call, tool result, reply — then the new user turn
    expect(ai?.requests[2].messages).toHaveLength(5);
  });

  it("corrects an entry through update_entry", async () => {
    let entryId = "";
    const { app } = await appWith([
      toolCall([{ name: "log_items", input: logItemsInput() }]),
      textReply("Logged."),
      () => toolCall([{ name: "update_entry", input: { entry_id: entryId, foods: [{ ...TOOL_EGGS, name: "3 scrambled eggs", kcal: 270 }], exercises: [] } }]),
      textReply("Updated to 3 eggs."),
    ]);
    const first = await send(app, "2 scrambled eggs");
    entryId = first.json().day.entries[0].id;
    const second = await send(app, "actually it was 3 eggs", randomUUID(), "2026-10-03T11:59:00.000Z");
    expect(second.json().day.entries).toHaveLength(1);
    expect(second.json().day.entries[0]).toMatchObject({ id: entryId, edited: true, foods: [{ name: "3 scrambled eggs", kcal: 270 }] });
    expect(second.json().reply.cards).toEqual([{ type: "entry", id: entryId }]);
  });

  it("refuses messages from the future or from more than a week ago", async () => {
    const { app } = await appWith([]);
    expect((await send(app, "x", randomUUID(), "2026-10-04T12:00:00.000Z")).json()).toEqual({ error: "future_date" });
    expect((await send(app, "x", randomUUID(), "2026-09-20T12:00:00.000Z")).json()).toEqual({ error: "too_old" });
  });
});

describe("POST /api/messages/:id/retry", () => {
  it("404s for unknown ids and 409s for messages that did not fail", async () => {
    const { app } = await appWith([textReply("Hi")]);
    expect((await retry(app, randomUUID())).statusCode).toBe(404);
    const ok = await send(app, "hello");
    expect((await retry(app, ok.json().user.id)).statusCode).toBe(409);
  });
});

describe("failInterrupted", () => {
  it("marks messages left pending by a restart so they can be retried", async () => {
    const { app } = await appWith([]);
    insertUserMessage(app.db, { id: "m1", date: "2026-10-03", text: "x", sentAt: NOW.toISOString(), nowIso: NOW.toISOString() });
    expect(failInterrupted(app.db)).toBe(1);
    expect(getMessage(app.db, "m1")).toMatchObject({ status: "failed", error_code: "interrupted" });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `messages.test.ts` cannot import `failInterrupted` (not exported yet).

- [ ] **Step 4: Implement**

Append to `server/src/messages/messages.ts` (and add `Card` to its shared type import):

```ts
export function getMessage(sql: Sql, id: string): MessageRow | null {
  return sql.select().from(messages).where(eq(messages.id, id)).get() ?? null;
}

export function getReply(sql: Sql, userMessageId: string): MessageRow | null {
  return sql.select().from(messages).where(eq(messages.reply_to, userMessageId)).get() ?? null;
}

export function insertUserMessage(sql: Sql, m: { id: string; date: string; text: string; sentAt: string; nowIso: string }): void {
  sql
    .insert(messages)
    .values({
      id: m.id, date: m.date, role: "user", text: m.text, cards: [], status: "pending",
      error_code: null, reply_to: null, sent_at: m.sentAt, created_at: m.nowIso,
    })
    .run();
}

export function setMessageStatus(sql: Sql, id: string, status: MessageStatus, errorCode: string | null): void {
  sql.update(messages).set({ status, error_code: errorCode }).where(eq(messages.id, id)).run();
}

export function insertReply(sql: Sql, r: { id: string; replyTo: string; date: string; text: string; cards: Card[]; nowIso: string }): void {
  sql
    .insert(messages)
    .values({
      id: r.id, date: r.date, role: "assistant", text: r.text, cards: r.cards, status: null,
      error_code: null, reply_to: r.replyTo, sent_at: null, created_at: r.nowIso,
    })
    .run();
}

/** A restart can strand messages as pending forever; mark them so Retry works. */
export function failInterrupted(sql: Sql): number {
  return sql.update(messages).set({ status: "failed", error_code: "interrupted" }).where(eq(messages.status, "pending")).run().changes;
}
```

`server/src/coach/process.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { AiClient, AiMessage, AiUsage } from "../ai/client.ts";
import { buildDayView, getDay, snapshotValues } from "../days/days.ts";
import type { Sql } from "../db/types.ts";
import { getMessage, insertReply, setMessageStatus } from "../messages/messages.ts";
import { getProfile } from "../profile/profile.ts";
import { todayIn } from "../time.ts";
import { runCoachLoop } from "./loop.ts";
import type { CoachFailure } from "./loop.ts";
import { buildSystemPrompt, buildTurnContext } from "./prompt.ts";
import { applyStaging, executeTool, newStaging } from "./staging.ts";
import type { ToolContext } from "./staging.ts";
import { appendTurns, getOrCreateThread, loadTurns } from "./thread.ts";
import { COACH_TOOLS } from "./tools.ts";

export const MAX_MODEL_CALLS = 5;

export interface CoachDeps {
  db: Sql;
  ai: AiClient | null;
  now: () => Date;
  budgetMs: number;
  newId?: () => string;
}

export type ProcessOutcomeCode = "done" | CoachFailure | "ai_unavailable" | "no_profile";

export interface ProcessOutcome {
  outcome: ProcessOutcomeCode;
  calls: number;
  usage: AiUsage | null;
}

async function withBudget<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function fail(sql: Sql, id: string, outcome: ProcessOutcomeCode, calls = 0, usage: AiUsage | null = null): ProcessOutcome {
  setMessageStatus(sql, id, "failed", outcome);
  return { outcome, calls, usage };
}

/**
 * Runs one user message through the coach. Nothing the coach does is written
 * until the whole loop has succeeded; then the entries, the conversation turns
 * and the reply commit in one transaction. A failure leaves only the failed
 * message, so Retry can never log the same meal twice.
 */
export async function processMessage(deps: CoachDeps, messageId: string): Promise<ProcessOutcome> {
  const message = getMessage(deps.db, messageId);
  if (!message) throw new Error(`message ${messageId} not found`);
  const profile = getProfile(deps.db);
  if (!profile) return fail(deps.db, messageId, "no_profile");
  const ai = deps.ai;
  if (!ai) return fail(deps.db, messageId, "ai_unavailable");

  const now = deps.now();
  const nowIso = now.toISOString();
  const today = todayIn(profile.timezone, now);
  const system = getOrCreateThread(deps.db, message.date, () => buildSystemPrompt(profile, message.date), nowIso);
  const history = loadTurns(deps.db, message.date);
  const view = buildDayView(deps.db, profile, message.date, today, nowIso);
  const userTurn: AiMessage = {
    role: "user",
    content: [
      { type: "text", text: buildTurnContext(view, now, profile.timezone) },
      { type: "text", text: message.text },
    ],
  };
  const staging = newStaging();
  const context: ToolContext = {
    sql: deps.db,
    profile,
    messageId,
    messageDate: message.date,
    sentAt: new Date(message.sent_at ?? message.created_at),
    today,
    weightKg: (date) => (getDay(deps.db, date) ?? snapshotValues(profile, date, nowIso)).weight_kg_used,
    staging,
    newId: deps.newId ?? (() => randomUUID()),
  };

  const result = await withBudget(deps.budgetMs, (signal) =>
    runCoachLoop({
      ai,
      system,
      tools: COACH_TOOLS,
      history,
      userTurn,
      execute: (name, input) => executeTool(name, input, context),
      signal,
      maxCalls: MAX_MODEL_CALLS,
    }),
  );
  if (!result.ok) return fail(deps.db, messageId, result.failure, result.calls, result.usage);

  const doneIso = deps.now().toISOString();
  deps.db.transaction((tx) => {
    const changed = applyStaging(tx, staging, profile, doneIso);
    appendTurns(tx, message.date, messageId, result.turns, doneIso);
    insertReply(tx, {
      id: randomUUID(),
      replyTo: messageId,
      date: message.date,
      text: result.replyText,
      cards: changed.map((id) => ({ type: "entry" as const, id })),
      nowIso: doneIso,
    });
    setMessageStatus(tx, messageId, "done", null);
  });
  return { outcome: "done", calls: result.calls, usage: result.usage };
}
```

`server/src/routes/messages.ts`:

```ts
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { processMessage } from "../coach/process.ts";
import type { ProcessOutcome } from "../coach/process.ts";
import { buildDayView, ensureDay } from "../days/days.ts";
import type { AppDeps } from "../deps.ts";
import { getMessage, getReply, insertUserMessage, setMessageStatus, toChatMessage } from "../messages/messages.ts";
import { getProfile } from "../profile/profile.ts";
import { MAX_BACKDATE_DAYS, MessageInput, daysBetween } from "../shared.ts";
import type { MessageResult } from "../shared.ts";
import { localDate, todayIn } from "../time.ts";
import { parseBody } from "./http.ts";

/** Coach failures are recorded on the message; only an unexpected crash lands here. */
async function runSafely(deps: AppDeps, id: string, log: FastifyBaseLogger): Promise<ProcessOutcome | null> {
  try {
    return await processMessage({ db: deps.db, ai: deps.ai, now: deps.now, budgetMs: deps.coachBudgetMs }, id);
  } catch (err) {
    log.error({ err }, "coach processing failed");
    setMessageStatus(deps.db, id, "failed", "internal");
    return null;
  }
}

function messageResult(deps: AppDeps, id: string): MessageResult {
  const profile = getProfile(deps.db);
  const user = getMessage(deps.db, id);
  if (!profile || !user) throw new Error(`message ${id} or the profile disappeared`);
  const reply = getReply(deps.db, id);
  const now = deps.now();
  return {
    user: toChatMessage(user),
    reply: reply ? toChatMessage(reply) : null,
    day: buildDayView(deps.db, profile, user.date, todayIn(profile.timezone, now), now.toISOString()),
  };
}

export function registerMessageRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/messages", async (req, reply) => {
    const input = parseBody(MessageInput, req.body, reply);
    if (!input) return reply;
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });

    // The id is made on the phone: a repeat gets what the first attempt produced.
    const existing = getMessage(deps.db, input.id);
    if (existing) {
      if (existing.status === "pending") return reply.code(409).send({ error: "in_progress" });
      return messageResult(deps, existing.id);
    }

    const now = deps.now();
    const nowIso = now.toISOString();
    const today = todayIn(profile.timezone, now);
    const sentAt = new Date(input.sent_at);
    // The day is when it was sent, so a message typed at 23:55 stays on its day (spec §7.5).
    const date = localDate(sentAt, profile.timezone);
    if (date > today) return reply.code(400).send({ error: "future_date" });
    if (daysBetween(date, today) > MAX_BACKDATE_DAYS) return reply.code(400).send({ error: "too_old" });

    deps.db.transaction((tx) => {
      ensureDay(tx, profile, date, nowIso);
      insertUserMessage(tx, { id: input.id, date, text: input.text, sentAt: sentAt.toISOString(), nowIso });
    });
    await runSafely(deps, input.id, req.log);
    return reply.code(201).send(messageResult(deps, input.id));
  });

  app.post<{ Params: { id: string } }>("/api/messages/:id/retry", async (req, reply) => {
    const existing = getMessage(deps.db, req.params.id);
    if (!existing || existing.role !== "user") return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "failed") return reply.code(409).send({ error: "not_failed" });
    setMessageStatus(deps.db, existing.id, "pending", null);
    await runSafely(deps, existing.id, req.log);
    return messageResult(deps, existing.id);
  });
}
```

In `server/src/routes/index.ts`, add the import and the registration:

```ts
import { registerMessageRoutes } from "./messages.ts";
```

```ts
  registerMessageRoutes(app, deps);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `messages.test.ts` 11 tests pass and every earlier suite still passes; no errors.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(coach): process messages atomically, with idempotent send and retry"
```

---

### Task 17: Metrics, the nightly snapshot and the server entry point

**Files:**
- Create: `server/src/metrics.ts`, `server/src/jobs.ts`, `server/src/main.ts`
- Modify: `server/src/deps.ts`, `server/src/app.ts`, `server/src/routes/messages.ts`, `server/test/helpers.ts`, `server/package.json`, root `package.json`
- Test: `server/test/ops.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces (`metrics.ts`): `interface Metrics { registry; httpRequests; coachMessages; coachModelCalls; coachTokens }`, `createMetrics()`, `serveMetrics(metrics, port): Promise<http.Server>` (only `/metrics`), `recordCoach(metrics | undefined, outcome: ProcessOutcome | null)`.
- Produces (`jobs.ts`): `runNightlySnapshot(sqlite, dir, keep, timeZone, now): string` (`fitness-YYYY-MM-DD.db`, keeps `keep`), `startNightlySnapshot({ sqlite, dir, keep, timeZone, log }): Cron` (03:00 local).
- Produces (`deps.ts`): `AppDeps.metrics?: Metrics`.
- Produces: `npm run dev:server` (development server with the sign-in bypass) and `npm start -w server`.

- [ ] **Step 1: Dependencies**

```bash
npm install -w server prom-client@^15.1.3 croner@^10.0.1
```

Add to the `scripts` in `server/package.json`:

```json
    "dev": "NODE_ENV=development DEV_AUTH_EMAIL=dev@localhost DATA_DIR=../.data node --watch src/main.ts",
    "start": "node --disable-warning=ExperimentalWarning src/main.ts"
```

Add to the `scripts` in the root `package.json`:

```json
    "dev:server": "npm run dev --workspace server"
```

- [ ] **Step 2: Write the failing test**

In `server/test/helpers.ts`, add `metrics?: Metrics` to the `testApp` options and pass `metrics: opts.metrics` to `buildApp`:

```ts
import type { Metrics } from "../src/metrics.ts";
```

```ts
export async function testApp(opts: { now?: Date; webDist?: string | null; ai?: AiClient | null; coachBudgetMs?: number; metrics?: Metrics } = {}) {
```

```ts
    coachBudgetMs: opts.coachBudgetMs ?? 90_000,
    metrics: opts.metrics,
```

`server/test/ops.test.ts`:

```ts
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runNightlySnapshot } from "../src/jobs.ts";
import { createMetrics, recordCoach, serveMetrics } from "../src/metrics.ts";
import { openTestDb, tempDir, testApp } from "./helpers.ts";
import type { TestApp } from "./helpers.ts";

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe("metrics", () => {
  it("count coach outcomes, model calls and tokens", async () => {
    const metrics = createMetrics();
    recordCoach(metrics, { outcome: "done", calls: 2, usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 } });
    recordCoach(metrics, null);
    const text = await metrics.registry.metrics();
    expect(text).toContain('fitnessai_coach_messages_total{outcome="done"} 1');
    expect(text).toContain('fitnessai_coach_messages_total{outcome="internal"} 1');
    expect(text).toContain("fitnessai_coach_model_calls_total 2");
    expect(text).toContain('fitnessai_coach_tokens_total{kind="input_tokens"} 200');
  });

  it("count HTTP requests by route", async () => {
    const metrics = createMetrics();
    ctx = await testApp({ metrics });
    await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(await metrics.registry.metrics()).toContain('fitnessai_http_requests_total{method="GET",route="/api/health",status="200"} 1');
  });

  it("are served on their own port, and nothing else is", async () => {
    const server = await serveMetrics(createMetrics(), 0);
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("process_cpu_user_seconds_total");
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(404);
    server.close();
  });
});

describe("runNightlySnapshot", () => {
  it("names each snapshot after the local date and keeps the newest", () => {
    const db = openTestDb();
    const dir = tempDir();
    for (const iso of ["2026-10-01T02:00:00Z", "2026-10-02T02:00:00Z", "2026-10-03T02:00:00Z"]) {
      runNightlySnapshot(db.sqlite, dir, 2, "Europe/London", new Date(iso));
    }
    expect(fs.readdirSync(dir).sort()).toEqual(["fitness-2026-10-02.db", "fitness-2026-10-03.db"]);
    db.close();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -w server`
Expected: FAIL — `Failed to load url ../src/metrics.ts`.

- [ ] **Step 4: Implement**

`server/src/metrics.ts`:

```ts
import http from "node:http";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";
import type { ProcessOutcome } from "./coach/process.ts";

export interface Metrics {
  registry: Registry;
  httpRequests: Counter<"method" | "route" | "status">;
  coachMessages: Counter<"outcome">;
  coachModelCalls: Counter;
  coachTokens: Counter<"kind">;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpRequests: new Counter<"method" | "route" | "status">({
      name: "fitnessai_http_requests_total", help: "HTTP requests by route and status",
      labelNames: ["method", "route", "status"], registers: [registry],
    }),
    coachMessages: new Counter<"outcome">({
      name: "fitnessai_coach_messages_total", help: "Coach messages by outcome",
      labelNames: ["outcome"], registers: [registry],
    }),
    coachModelCalls: new Counter({ name: "fitnessai_coach_model_calls_total", help: "Calls to the Claude API", registers: [registry] }),
    coachTokens: new Counter<"kind">({
      name: "fitnessai_coach_tokens_total", help: "Claude tokens by kind",
      labelNames: ["kind"], registers: [registry],
    }),
  };
}

export function recordCoach(metrics: Metrics | undefined, result: ProcessOutcome | null): void {
  if (!metrics) return;
  metrics.coachMessages.inc({ outcome: result?.outcome ?? "internal" });
  if (!result) return;
  metrics.coachModelCalls.inc(result.calls);
  if (result.usage) for (const [kind, count] of Object.entries(result.usage)) metrics.coachTokens.inc({ kind }, count);
}

/** Prometheus scrapes this port; no Ingress routes to it, so it is never public (spec §13). */
export function serveMetrics(metrics: Metrics, port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.statusCode = 404;
      res.end();
      return;
    }
    metrics.registry.metrics().then(
      (body) => {
        res.setHeader("content-type", metrics.registry.contentType);
        res.end(body);
      },
      () => {
        res.statusCode = 500;
        res.end();
      },
    );
  });
  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server)));
}
```

`server/src/jobs.ts`:

```ts
import type Database from "better-sqlite3";
import { Cron } from "croner";
import type { FastifyBaseLogger } from "fastify";
import { pruneSnapshots, snapshot } from "./db/snapshot.ts";
import { localDate } from "./time.ts";

export function runNightlySnapshot(sqlite: Database.Database, dir: string, keep: number, timeZone: string, now: Date): string {
  const file = snapshot(sqlite, dir, `fitness-${localDate(now, timeZone)}.db`);
  pruneSnapshots(dir, "fitness-", keep);
  return file;
}

/** 03:00 local, half an hour before the cluster's restic run copies /data (spec §14.4). */
export function startNightlySnapshot(opts: {
  sqlite: Database.Database;
  dir: string;
  keep: number;
  timeZone: string;
  log: FastifyBaseLogger;
}): Cron {
  return new Cron("0 3 * * *", { timezone: opts.timeZone }, () => {
    try {
      const file = runNightlySnapshot(opts.sqlite, opts.dir, opts.keep, opts.timeZone, new Date());
      opts.log.info({ file }, "nightly snapshot written");
    } catch (err) {
      opts.log.error({ err }, "nightly snapshot failed");
    }
  });
}
```

In `server/src/deps.ts`, add:

```ts
import type { Metrics } from "./metrics.ts";
```

```ts
  metrics?: Metrics;
```

In `server/src/app.ts`, insert right after `app.decorateRequest("identity", null);`:

```ts
  if (deps.metrics) {
    const requests = deps.metrics.httpRequests;
    app.addHook("onResponse", async (req, reply) => {
      // The route pattern, not the URL, keeps label cardinality bounded.
      requests.inc({ method: req.method, route: req.routeOptions.url ?? "unmatched", status: String(reply.statusCode) });
    });
  }
```

In `server/src/routes/messages.ts`, import `recordCoach` and record every outcome — replace `runSafely` with:

```ts
import { recordCoach } from "../metrics.ts";
```

```ts
/** Coach failures are recorded on the message; only an unexpected crash lands in the catch. */
async function runSafely(deps: AppDeps, id: string, log: FastifyBaseLogger): Promise<ProcessOutcome | null> {
  let outcome: ProcessOutcome | null = null;
  try {
    outcome = await processMessage({ db: deps.db, ai: deps.ai, now: deps.now, budgetMs: deps.coachBudgetMs }, id);
  } catch (err) {
    log.error({ err }, "coach processing failed");
    setMessageStatus(deps.db, id, "failed", "internal");
  }
  recordCoach(deps.metrics, outcome);
  return outcome;
}
```

`server/src/main.ts`:

```ts
import path from "node:path";
import { anthropicClient } from "./ai/anthropic.ts";
import { buildApp } from "./app.ts";
import { createVerifier, devVerifier } from "./auth/access.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/open.ts";
import { startNightlySnapshot } from "./jobs.ts";
import { failInterrupted } from "./messages/messages.ts";
import { createMetrics, serveMetrics } from "./metrics.ts";
import { getProfile } from "./profile/profile.ts";

const config = loadConfig(process.env);
const snapshotDir = path.join(config.dataDir, "snapshots");
const database = openDatabase({ file: path.join(config.dataDir, "fitness.db"), snapshotDir });
failInterrupted(database.db);

// loadConfig guarantees Access settings whenever the development bypass is off.
const verifier = config.devAuthEmail ? devVerifier(config.devAuthEmail) : createVerifier(config.access!);
const ai = config.anthropic.apiKey
  ? anthropicClient({ apiKey: config.anthropic.apiKey, model: config.anthropic.model, effort: config.anthropic.effort })
  : null;
const metrics = createMetrics();
const app = buildApp({
  db: database.db,
  verifier,
  ai,
  now: () => new Date(),
  webDist: config.webDist,
  coachBudgetMs: config.coachBudgetMs,
  metrics,
  logger: true,
});

const job = startNightlySnapshot({
  sqlite: database.sqlite,
  dir: snapshotDir,
  keep: config.snapshotKeep,
  timeZone: getProfile(database.db)?.timezone ?? "Europe/London",
  log: app.log,
});
const metricsServer = await serveMetrics(metrics, config.metricsPort);
await app.listen({ host: "0.0.0.0", port: config.port });
if (!ai) app.log.warn("ANTHROPIC_API_KEY is not set: the coach is off; manual logging still works");

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  job.stop();
  metricsServer.close();
  await app.close();
  database.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w server && npm run typecheck && npm run lint`
Expected: `ops.test.ts` 4 tests pass and every earlier suite still passes; no errors.

- [ ] **Step 6: Boot the server for real**

In one terminal:

```bash
npm run dev:server
```

Expected: JSON log lines including `Server listening at http://0.0.0.0:8080` and, without an API key, the warning that the coach is off.

In a second terminal:

```bash
curl -s localhost:8080/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/profile
curl -s localhost:9464/metrics | grep -c fitnessai_
```

Expected: `{"ok":true}`; `404` (the development bypass signs you in, and there is no profile yet); a count above 0. Stop the server with Ctrl-C and check it logs `shutting down`. Delete the scratch database with `rm -rf .data`.

- [ ] **Step 7: OWNER — one live message to Claude (a few cents)**

The tests never call Claude. Before deploying, prove the real request is accepted: the strict tool schemas, `fallbacks: "default"` and the thinking-binding beta. Ask the owner to export their key in the server's terminal and start it again:

```bash
export ANTHROPIC_API_KEY=...   # the owner types this; never paste a key into chat
npm run dev:server
```

Then, in a second terminal:

```bash
curl -s -X PUT localhost:8080/api/profile -H 'content-type: application/json' \
  -d '{"sex":"male","birth_date":"1991-03-15","height_cm":180,"weight_kg":80,"activity_level":"light","goal":"lose","goal_rate_kg_week":0.5}' > /dev/null
id=$(node -e 'console.log(crypto.randomUUID())'); now=$(node -e 'console.log(new Date().toISOString())')
curl -s -X POST localhost:8080/api/messages -H 'content-type: application/json' \
  -d "{\"id\":\"$id\",\"sent_at\":\"$now\",\"text\":\"2 scrambled eggs and a coffee with semi-skimmed milk\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.user.status,r.user.error_code);console.log(r.reply?.text);console.log(r.day.entries[0]?.foods.map(f=>`${f.name}: ${Math.round(f.kcal)} kcal, sat fat ${f.saturated_fat_g} g, fluid ${f.fluid_ml} ml, groups ${JSON.stringify(f.groups)}`).join("\n"))})'
```

Expected: `done null`, a one- or two-sentence reply, and two or more foods with plausible numbers (the coffee with `fluid_ml` above 0). If the status is `failed ai_error`, the server log names the cause: a 400 mentioning `fallbacks` or `block_binding` means this account does not have that beta yet — delete that one field (and its header from `COACH_BETAS`) in `server/src/ai/anthropic.ts`, update `anthropic.test.ts` to match, and run the check again. Stop the server and `rm -rf .data` afterwards.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server
git commit -m "feat(server): metrics, nightly snapshots and the entry point"
```

---

### Task 18: Web workspace, API client and signed-out detection

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/public/logo.svg` (+ generated icons)
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`, `web/src/shared.ts`, `web/src/api.ts`, `web/src/session.tsx`
- Create: `web/src/components/TabBar.tsx`, `web/src/components/SignedOutBanner.tsx`, `web/src/pages/TodayPage.tsx`, `web/src/pages/SettingsPage.tsx` (both pages are stand-ins replaced in Tasks 19 and 21)
- Create: `web/src/test/setup.ts`, `web/src/test/render.tsx`, `web/src/test/fixtures.ts`
- Modify: root `package.json`
- Test: `web/src/api.test.ts`

**Interfaces:**
- Produces (`api.ts`): `type ApiErrorKind = "signed_out" | "offline" | "http"`, `class ApiError { kind; status; code }`, `api<T>(path, options?: { method?: string; json?: unknown }): Promise<T>` (POST when `json` is given and no method; `redirect: "manual"`), `onSignedOut(listener): () => void`.
- Produces (`session.tsx`): `SessionProvider`, `useSignedOut(): boolean`, `signInAgain(): void` (full navigation to `/?reauth=<timestamp>`).
- Produces (`shared.ts`): runtime `addDays`, `daysBetween`, `isIsoDate`, `ACTIVITY_LEVEL_KEYS`, `BODY_GOALS`, `EXERCISE_CATEGORIES`, `SEXES`; every API type; the input types `ExerciseItemInput`, `FoodItemInput`, `MessageInput`, `Profile`, `ProfileInput`.
- Produces (tests): `renderWithProviders(ui, { route?, path? })` (shows the current path in `data-testid="location"`), `mockFetch(handler)`, `jsonResponse(body, status?)`, fixtures `foodItem()`, `entry()`, `message()`, `dayView()`.

- [ ] **Step 1: Create the workspace**

`web/package.json`:

```json
{
  "name": "@fitnessai/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "icons": "pwa-assets-generator --preset minimal-2023 public/logo.svg"
  }
}
```

In the root `package.json` set:

```json
  "workspaces": ["shared", "server", "web"],
```

```json
    "typecheck": "tsc -p shared && tsc -p server && tsc -p web",
    "build": "npm run build --workspace web",
    "dev:web": "npm run dev --workspace web",
```

Install (everything is a dev dependency: the browser bundle is built, so none of it ships in the server image):

```bash
npm install -w web -D react@^19.3.0 react-dom@^19.3.0 react-router@^7 @tanstack/react-query@^5 \
  vite@^8 @vitejs/plugin-react@^6 tailwindcss@^4 @tailwindcss/vite@^4 vite-plugin-pwa@^1.3.0 \
  @vite-pwa/assets-generator@^1 vitest@^5.0.3 jsdom@^30 @testing-library/react@^16 \
  @testing-library/jest-dom@^7 @testing-library/user-event@^14 @types/react@^19 @types/react-dom@^19
```

`web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["es2024", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["node", "vite/client", "vite-plugin-pwa/client"]
  },
  "include": ["src", "../shared/src", "vite.config.ts"]
}
```

`web/vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "fitnessAI",
        short_name: "fitnessAI",
        description: "Food, training and goals logbook with an AI coach",
        start_url: "/day/today",
        scope: "/",
        display: "standalone",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Never answer these from the cache: the API, Cloudflare Access's own
        // endpoints, and the sign-in navigation, which must reach the network so
        // Access can show its login page (spec §11.3).
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//, /[?&]reauth=/],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8080" } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0f14" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <title>fitnessAI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/public/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0b0f14"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#34d399" stroke-width="48"/>
  <path d="M232 168 196 272h56l-24 88 92-124h-60l32-68z" fill="#34d399"/>
</svg>
```

Generate the icons and keep them in the repository:

```bash
npm run icons -w web
```

Expected: `web/public/` now also holds `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png` and `favicon.ico`.

- [ ] **Step 2: Shell files with no logic of their own**

`web/src/index.css`:

```css
@import "tailwindcss";

html {
  -webkit-text-size-adjust: 100%;
}

body {
  overscroll-behavior-y: none;
}
```

`web/src/shared.ts`:

```ts
// The web app's view of the shared code. Only dates and vocabularies are runtime
// imports; the rest is types, so Zod never ends up in the browser bundle.
export { addDays, daysBetween, isIsoDate } from "../../shared/src/dates.ts";
export { ACTIVITY_LEVEL_KEYS, BODY_GOALS, EXERCISE_CATEGORIES, SEXES } from "../../shared/src/vocab.ts";
export type { ActivityLevel, BodyGoal, ExerciseCategory, Sex } from "../../shared/src/vocab.ts";
export type * from "../../shared/src/api.ts";
export type { ExerciseItemInput, FoodItemInput, MessageInput, Profile, ProfileInput } from "../../shared/src/schemas.ts";
```

`web/src/components/TabBar.tsx`:

```tsx
import { Link, useLocation } from "react-router";

function tabClass(active: boolean): string {
  return `flex h-12 flex-1 items-center justify-center text-sm ${active ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`;
}

export function TabBar() {
  const { pathname } = useLocation();
  const onDay = pathname.startsWith("/day");
  const onSettings = pathname === "/settings";
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950">
      <Link to="/day/today" className={tabClass(onDay)} aria-current={onDay ? "page" : undefined}>
        Today
      </Link>
      <Link to="/settings" className={tabClass(onSettings)} aria-current={onSettings ? "page" : undefined}>
        Settings
      </Link>
    </nav>
  );
}
```

`web/src/pages/TodayPage.tsx` (stand-in until Task 19):

```tsx
export function TodayPage() {
  return <main className="p-6">Today</main>;
}
```

`web/src/pages/SettingsPage.tsx` (stand-in until Task 21):

```tsx
export function SettingsPage() {
  return <main className="p-6">Settings</main>;
}
```

- [ ] **Step 3: Test utilities and the failing test**

`web/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Times in tests are formatted on the runner's clock; pin it.
process.env.TZ = "UTC";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
```

`web/src/test/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { vi } from "vitest";

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

/** Renders inside a fresh query client and a memory router; the probe shows the current path. */
export function renderWithProviders(ui: ReactElement, { route = "/", path = "*" }: { route?: string; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...result };
}

export function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
```

`web/src/test/fixtures.ts`:

```ts
import type { ChatMessage, DayView, Entry, FoodItem } from "../shared.ts";

export function foodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: "f1", position: 0, name: "Porridge", quantity: "1 bowl", grams: 250, kcal: 300, protein_g: 10,
    carbs_g: 50, fat_g: 6, fibre_g: 5, saturated_fat_g: 1.5, sugars_g: 8, salt_g: 0.2, fluid_ml: 0,
    alcohol_units: 0, assumption: "", saved_food_id: null, groups: [{ group: "wholegrains", portions: 1 }],
    ...overrides,
  };
}

export function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "e1", date: "2026-10-03", logged_at: "2026-10-03T07:10:00.000Z", source: "manual",
    message_id: null, edited: false, foods: [foodItem()], exercises: [], ...overrides,
  };
}

export function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1", date: "2026-10-03", role: "user", text: "porridge", status: "done", error_code: null,
    cards: [], reply_to: null, sent_at: "2026-10-03T07:09:00.000Z", created_at: "2026-10-03T07:09:00.000Z",
    ...overrides,
  };
}

export function dayView(overrides: Partial<DayView> = {}): DayView {
  const targets = { kcal: 2310, protein_g: 150, carbs_g: 260, fat_g: 75, fibre_g: 30 };
  return {
    date: "2026-10-03", today: "2026-10-03",
    targets: { base: targets, adjusted: targets, add_back_kcal: 0, workout_kcal: 0 },
    totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0 },
    entries: [], messages: [], ...overrides,
  };
}
```

`web/src/api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError, api, onSignedOut } from "./api.ts";
import { jsonResponse, mockFetch } from "./test/render.tsx";

describe("api", () => {
  it("returns the JSON body of a successful response", async () => {
    mockFetch(() => jsonResponse({ ok: true }));
    await expect(api("/api/health")).resolves.toEqual({ ok: true });
  });

  it("sends JSON as a POST and asks to see redirects", async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, 201));
    await api("/api/messages", { json: { text: "hi" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: '{"text":"hi"}', headers: { "content-type": "application/json" } });
  });

  it("treats Cloudflare's sign-in redirect as signed out and tells listeners", async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    mockFetch(() => ({ type: "opaqueredirect", status: 0, ok: false }) as Response);
    await expect(api("/api/days/today")).rejects.toMatchObject({ kind: "signed_out" });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("treats a 401 as signed out", async () => {
    mockFetch(() => new Response(null, { status: 401 }));
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "signed_out" });
  });

  it("reports a network failure as offline, not signed out", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api("/api/profile")).rejects.toMatchObject({ kind: "offline" });
  });

  it("carries the server's error code", async () => {
    mockFetch(() => jsonResponse({ error: "no_profile" }, 409));
    const failure = await api("/api/days/today").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ kind: "http", status: 409, code: "no_profile" });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npm test -w web`
Expected: FAIL — `Failed to load url ./api.ts`.

- [ ] **Step 5: Implement the API client, the session and the app**

`web/src/api.ts`:

```ts
// Every call to the server goes through api(). The rule: a request either
// resolves with JSON or throws an ApiError that says what kind of failure it was.

export type ApiErrorKind = "signed_out" | "offline" | "http";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;

  constructor(kind: ApiErrorKind, status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const signedOutListeners = new Set<() => void>();

/** Called whenever a request discovers the Access session has expired. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

export async function api<T>(path: string, options: { method?: string; json?: unknown } = {}): Promise<T> {
  const hasBody = options.json !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      // Our API never redirects. Asking to see redirects is how an expired Access
      // session (a redirect to its login page) is told apart from being offline.
      redirect: "manual",
      credentials: "same-origin",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.json) : undefined,
    });
  } catch {
    throw new ApiError("offline", 0, "offline", "You appear to be offline.");
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 401) {
    for (const listener of signedOutListeners) listener();
    throw new ApiError("signed_out", res.status, "signed_out", "Signed out");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError("http", res.status, body.error ?? "http_error", `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

`web/src/session.tsx`:

```tsx
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { onSignedOut } from "./api.ts";

const SignedOutContext = createContext(false);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => onSignedOut(() => setSignedOut(true)), []);
  return <SignedOutContext.Provider value={signedOut}>{children}</SignedOutContext.Provider>;
}

export function useSignedOut(): boolean {
  return useContext(SignedOutContext);
}

/** A full navigation that skips the service worker's cache, so Cloudflare Access can show its login page. */
export function signInAgain(): void {
  window.location.assign(`/?reauth=${Date.now()}`);
}
```

`web/src/components/SignedOutBanner.tsx`:

```tsx
import { signInAgain, useSignedOut } from "../session.tsx";

export function SignedOutBanner() {
  if (!useSignedOut()) return null;
  return (
    <div role="alert" className="sticky top-0 z-30 bg-amber-400 px-4 pb-2 pt-[calc(env(safe-area-inset-top)_+_0.5rem)] text-sm text-slate-900">
      Signed out.{" "}
      <button type="button" onClick={signInAgain} className="font-semibold underline">
        Tap to sign in
      </button>
    </div>
  );
}
```

`web/src/App.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api.ts";
import { SignedOutBanner } from "./components/SignedOutBanner.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { TodayPage } from "./pages/TodayPage.tsx";
import { SessionProvider } from "./session.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Retry only when the network dropped; a refusal will not change by asking again.
      retry: (failures, error) => error instanceof ApiError && error.kind === "offline" && failures < 2,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <div className="min-h-dvh bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <SignedOutBanner />
            <Routes>
              <Route path="/" element={<Navigate to="/day/today" replace />} />
              <Route path="/day/:date" element={<TodayPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/day/today" replace />} />
            </Routes>
            <TabBar />
          </div>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// After signing in again the app reloads at /?reauth=…; tidy the address bar.
const url = new URL(window.location.href);
if (url.searchParams.has("reauth")) {
  url.searchParams.delete("reauth");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Run the tests, then build**

Run: `npm test -w web`
Expected: `api.test.ts` 6 tests pass.

Run: `npm run typecheck && npm run lint && npm run build`
Expected: no errors; the build prints `PWA v1.3.0 … files generated dist/sw.js` and writes `web/dist/`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json web
git commit -m "feat(web): PWA scaffold, API client and signed-out detection"
```

---

### Task 19: The Today screen

**Files:**
- Create: `web/src/queries.ts`, `web/src/format.ts`
- Create: `web/src/components/DayNav.tsx`, `Summary.tsx`, `Feed.tsx`, `EntryCard.tsx`, `Composer.tsx`, `SetupPrompt.tsx`
- Replace: `web/src/pages/TodayPage.tsx`
- Test: `web/src/components/DayNav.test.tsx`, `web/src/components/Summary.test.tsx`, `web/src/components/Feed.test.tsx`, `web/src/components/Composer.test.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 18), `DayView`, `Entry`, `ChatMessage`, `MessageInput`, `MessageResult` (shared).
- Produces (`queries.ts`): `dayKey(date)`, `useDay(date)` (GET `/api/days/:date`), `storeDay(client, view)` (writes the view under its date and under `"today"` when it is today).
- Produces (`format.ts`): `dayLabel(date, today)`, `kcal10(kcal)`, `timeOf(iso)`, `failureText(code)`.
- Produces (components): `<DayNav date today />`, `<Summary view />`, `buildFeed(view, logOnly): FeedItem[]`, `<Feed view logOnly onRetry onEdit? onUndo? />` (a reply offers **Undo** for the entries that its own message created — spec §6.1: Undo deletes), `<EntryCard entry onEdit? />`, `<Composer />`, `<SetupPrompt />`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/DayNav.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render.tsx";
import { DayNav } from "./DayNav.tsx";

describe("DayNav", () => {
  it("labels today and cannot go into the future", () => {
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
  });

  it("steps back a day", async () => {
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/day/2026-10-02");
  });

  it("names older days and returns to /day/today when stepping onto today", async () => {
    renderWithProviders(<DayNav date="2026-10-02" today="2026-10-03" />);
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/day/today");
  });
});
```

`web/src/components/Summary.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dayView } from "../test/fixtures.ts";
import { Summary } from "./Summary.tsx";

describe("Summary", () => {
  it("shows eaten against the adjusted target, the exercise add-back and the macro bars", () => {
    const adjusted = { kcal: 2490, protein_g: 150, carbs_g: 294, fat_g: 80, fibre_g: 30 };
    const view = dayView({
      targets: { base: { kcal: 2310, protein_g: 150, carbs_g: 260, fat_g: 75, fibre_g: 30 }, adjusted, add_back_kcal: 180, workout_kcal: 360 },
      totals: { kcal: 1240, protein_g: 98, carbs_g: 140, fat_g: 41, fibre_g: 12, saturated_fat_g: 9, sugars_g: 30, salt_g: 3, fluid_ml: 500, alcohol_units: 0 },
    });
    render(<Summary view={view} />);
    expect(screen.getByText("1240")).toBeInTheDocument();
    expect(screen.getByText("/ 2490 kcal")).toBeInTheDocument();
    expect(screen.getByText("+180 kcal from 360 kcal of exercise")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Protein" })).toHaveAttribute("aria-valuenow", "98");
  });
});
```

`web/src/components/Feed.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry, message } from "../test/fixtures.ts";
import { Feed, buildFeed } from "./Feed.tsx";

describe("buildFeed", () => {
  const coachEntry = entry({ id: "e1", logged_at: "2026-10-03T08:00:00.000Z", source: "coach" });
  const manual = entry({ id: "e2", logged_at: "2026-10-03T09:00:00.000Z" });
  const question = message({ id: "m1", created_at: "2026-10-03T07:59:00.000Z" });
  const reply = message({ id: "m2", role: "assistant", status: null, created_at: "2026-10-03T08:00:05.000Z", cards: [{ type: "entry", id: "e1" }], reply_to: "m1" });
  const view = dayView({ entries: [coachEntry, manual], messages: [question, reply] });

  it("keeps coach-created entries under their reply and lists manual entries on their own", () => {
    expect(buildFeed(view, false).map((i) => (i.kind === "entry" ? i.entry.id : i.message.id))).toEqual(["m1", "m2", "e2"]);
  });

  it("shows only entries, in time order, in log-only mode", () => {
    expect(buildFeed(view, true).map((i) => (i.kind === "entry" ? i.entry.id : i.message.id))).toEqual(["e1", "e2"]);
  });
});

describe("Feed", () => {
  it("explains a failed message and offers Retry", async () => {
    const onRetry = vi.fn();
    const failed = message({ id: "m9", status: "failed", error_code: "timeout" });
    render(<Feed view={dayView({ messages: [failed] })} logOnly={false} onRetry={onRetry} />);
    expect(screen.getByText(/The coach took too long/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("m9");
  });

  it("offers Undo for what a reply logged, but not for older entries it corrected", async () => {
    const onUndo = vi.fn();
    const logged = entry({ id: "new", message_id: "m1", source: "coach" });
    const corrected = entry({ id: "old", message_id: "m0", source: "coach", edited: true });
    const reply = message({ id: "m2", role: "assistant", status: null, reply_to: "m1", cards: [{ type: "entry", id: "new" }, { type: "entry", id: "old" }] });
    render(<Feed view={dayView({ entries: [logged, corrected], messages: [message({ id: "m1" }), reply] })} logOnly={false} onRetry={vi.fn()} onUndo={onUndo} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledWith(["new"]);
  });
});
```

`web/src/components/Composer.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

describe("Composer", () => {
  it("sends the text with a fresh id and timestamp, then clears the box", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ user: message(), reply: null, day: dayView() }, 201));
    renderWithProviders(<Composer />);
    await userEvent.type(screen.getByLabelText("Message your coach"), "2 eggs on toast");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByLabelText("Message your coach")).toHaveValue(""));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    const body = JSON.parse(String(init?.body));
    expect(body.text).toBe("2 eggs on toast");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(body.sent_at))).toBe(false);
  });

  it("keeps the text and explains when the phone is offline", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    renderWithProviders(<Composer />);
    await userEvent.type(screen.getByLabelText("Message your coach"), "banana");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Message your coach")).toHaveValue("banana");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w web`
Expected: FAIL — `Failed to load url ./DayNav.tsx` (and the other new components).

- [ ] **Step 3: Implement**

`web/src/queries.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { DayView } from "./shared.ts";

export const dayKey = (date: string) => ["day", date] as const;

export function useDay(date: string) {
  return useQuery({ queryKey: dayKey(date), queryFn: () => api<DayView>(`/api/days/${date}`) });
}

/** Puts a fresh DayView from a mutation into the cache, under its date and under "today" when it is today. */
export function storeDay(client: QueryClient, view: DayView): void {
  client.setQueryData(dayKey(view.date), view);
  if (view.date === view.today) client.setQueryData(dayKey("today"), view);
}
```

`web/src/format.ts`:

```ts
import { addDays } from "./shared.ts";

/** "Today", "Yesterday", or e.g. "Thu 1 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Targets are shown to the nearest 10 kcal (spec §7.1). */
export const kcal10 = (kcal: number): number => Math.round(kcal / 10) * 10;

/** The wall-clock time of an ISO timestamp on the phone's own clock. */
export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const FAILURES: Record<string, string> = {
  ai_unavailable: "The coach is switched off. Add it manually instead.",
  timeout: "The coach took too long.",
  ai_error: "The coach couldn't be reached.",
  ai_rate_limited: "The coach is busy. Try again in a minute.",
  refused: "The coach declined this message.",
  max_tokens: "The reply was cut off.",
  tool_loop_limit: "The coach got stuck on this one.",
  interrupted: "Interrupted by a restart.",
  no_profile: "Set up your profile first.",
  internal: "Something went wrong.",
};

export function failureText(code: string | null): string {
  return (code !== null && FAILURES[code]) || "Something went wrong.";
}
```

`web/src/components/DayNav.tsx`:

```tsx
import { useNavigate } from "react-router";
import { dayLabel } from "../format.ts";
import { addDays } from "../shared.ts";

export function DayNav({ date, today }: { date: string; today: string }) {
  const navigate = useNavigate();
  const go = (target: string) => navigate(target >= today ? "/day/today" : `/day/${target}`);
  const arrow = "h-10 w-10 rounded-full text-2xl leading-none disabled:opacity-30";
  return (
    <nav aria-label="Day" className="flex items-center justify-between gap-2 py-2">
      <button type="button" aria-label="Previous day" className={arrow} onClick={() => go(addDays(date, -1))}>
        ‹
      </button>
      <div className="flex flex-col items-center">
        <span className="font-semibold">{dayLabel(date, today)}</span>
        <input
          type="date"
          aria-label="Pick a day"
          value={date}
          max={today}
          onChange={(event) => {
            if (event.target.value) go(event.target.value);
          }}
          className="bg-transparent text-xs text-slate-500"
        />
      </div>
      <button type="button" aria-label="Next day" className={arrow} disabled={date >= today} onClick={() => go(addDays(date, 1))}>
        ›
      </button>
    </nav>
  );
}
```

`web/src/components/Summary.tsx`:

```tsx
import { kcal10 } from "../format.ts";
import type { DayView } from "../shared.ts";

function Bar({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span>
          {Math.round(value)} / {Math.round(target)} g
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Summary({ view }: { view: DayView }) {
  const target = view.targets.adjusted;
  const eaten = view.totals;
  return (
    <section aria-label="Day summary" className="pb-2">
      <p className="text-2xl font-semibold">
        <span>{Math.round(eaten.kcal)}</span> <span className="text-base font-normal text-slate-500">/ {kcal10(target.kcal)} kcal</span>
      </p>
      {view.targets.add_back_kcal > 0 && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          +{kcal10(view.targets.add_back_kcal)} kcal from {Math.round(view.targets.workout_kcal)} kcal of exercise
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Bar label="Protein" value={eaten.protein_g} target={target.protein_g} />
        <Bar label="Carbs" value={eaten.carbs_g} target={target.carbs_g} />
        <Bar label="Fat" value={eaten.fat_g} target={target.fat_g} />
        <Bar label="Fibre" value={eaten.fibre_g} target={target.fibre_g} />
      </div>
    </section>
  );
}
```

`web/src/components/EntryCard.tsx`:

```tsx
import { timeOf } from "../format.ts";
import type { Entry } from "../shared.ts";

export function EntryCard({ entry, onEdit }: { entry: Entry; onEdit?: (entry: Entry) => void }) {
  const eaten = entry.foods.reduce((sum, f) => sum + f.kcal, 0);
  const burned = entry.exercises.reduce((sum, x) => sum + x.kcal, 0);
  const names = [...entry.foods.map((f) => f.name), ...entry.exercises.map((x) => x.name)].join(", ");
  const facts = [
    eaten > 0 ? `${Math.round(eaten)} kcal` : null,
    burned > 0 ? `${Math.round(burned)} kcal burned` : null,
    entry.edited ? "edited" : null,
  ].filter(Boolean);
  const notes = [...entry.foods, ...entry.exercises].filter((item) => item.assumption);
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{names}</span>
        <span className="shrink-0 text-xs text-slate-500">{timeOf(entry.logged_at)}</span>
      </span>
      <span className="block text-sm text-slate-600 dark:text-slate-300">{facts.join(" · ")}</span>
      {notes.map((item) => (
        <span key={item.id} className="block text-xs italic text-slate-500">
          {item.name}: {item.assumption}
        </span>
      ))}
    </>
  );
  const className = "block w-full rounded-xl border border-slate-200 p-3 text-left dark:border-slate-800";
  return onEdit ? (
    <button type="button" className={className} onClick={() => onEdit(entry)}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
```

`web/src/components/Feed.tsx`:

```tsx
import { failureText } from "../format.ts";
import type { ChatMessage, DayView, Entry } from "../shared.ts";
import { EntryCard } from "./EntryCard.tsx";

export type FeedItem = { kind: "message"; at: string; message: ChatMessage } | { kind: "entry"; at: string; entry: Entry };

const byTime = (items: FeedItem[]) => [...items].sort((a, b) => a.at.localeCompare(b.at));

/** The day as one timeline: the conversation, with coach-made entries under their reply. */
export function buildFeed(view: DayView, logOnly: boolean): FeedItem[] {
  const asItems = (list: Entry[]): FeedItem[] => list.map((entry) => ({ kind: "entry", at: entry.logged_at, entry }));
  if (logOnly) return byTime(asItems(view.entries));
  const carded = new Set(view.messages.flatMap((m) => m.cards.map((c) => c.id)));
  return byTime([
    ...view.messages.map((message): FeedItem => ({ kind: "message", at: message.created_at, message })),
    ...asItems(view.entries.filter((e) => !carded.has(e.id))),
  ]);
}

interface FeedProps {
  view: DayView;
  logOnly: boolean;
  onRetry: (messageId: string) => void;
  onEdit?: (entry: Entry) => void;
  /** Deletes what a reply logged (spec §6.1: Undo is a delete). */
  onUndo?: (entryIds: string[]) => void;
}

function Bubble({ message, entries, onRetry, onEdit, onUndo }: { message: ChatMessage; entries: Map<string, Entry> } & Pick<FeedProps, "onRetry" | "onEdit" | "onUndo">) {
  if (message.role === "user") {
    return (
      <div className="ml-10 flex flex-col items-end">
        <p className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-3 py-2 text-white">{message.text}</p>
        {message.status === "pending" && <span className="mt-1 text-xs text-slate-500">Sending…</span>}
        {message.status === "failed" && (
          <span className="mt-1 text-xs text-red-600">
            {failureText(message.error_code)}{" "}
            <button type="button" className="font-semibold underline" onClick={() => onRetry(message.id)}>
              Retry
            </button>
          </span>
        )}
      </div>
    );
  }
  // Undo removes only what this reply's own message logged; an older entry it
  // corrected stays (open it to change or delete it).
  const undoable = message.cards
    .map((card) => entries.get(card.id))
    .filter((entry): entry is Entry => entry !== undefined && entry.message_id === message.reply_to)
    .map((entry) => entry.id);
  return (
    <div className="mr-10 flex flex-col gap-2">
      {message.text && <p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 dark:bg-slate-800">{message.text}</p>}
      {message.cards.map((card) => {
        const entry = entries.get(card.id);
        return entry ? (
          <EntryCard key={card.id} entry={entry} onEdit={onEdit} />
        ) : (
          <p key={card.id} className="text-xs text-slate-500">
            Entry removed
          </p>
        );
      })}
      {onUndo && undoable.length > 0 && (
        <button type="button" onClick={() => onUndo(undoable)} className="self-start text-xs font-medium text-slate-500 underline">
          Undo
        </button>
      )}
    </div>
  );
}

export function Feed({ view, logOnly, onRetry, onEdit, onUndo }: FeedProps) {
  const items = buildFeed(view, logOnly);
  const entries = new Map(view.entries.map((e) => [e.id, e]));
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-slate-500">
        {view.date === view.today ? "Nothing logged yet. Tell the coach what you ate or did." : "Nothing logged this day."}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3 px-4 py-4">
      {items.map((item) =>
        item.kind === "entry" ? (
          <li key={`e-${item.entry.id}`}>
            <EntryCard entry={item.entry} onEdit={onEdit} />
          </li>
        ) : (
          <li key={`m-${item.message.id}`}>
            <Bubble message={item.message} entries={entries} onRetry={onRetry} onEdit={onEdit} onUndo={onUndo} />
          </li>
        ),
      )}
    </ol>
  );
}
```

`web/src/components/Composer.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.ts";
import { storeDay } from "../queries.ts";
import type { MessageInput, MessageResult } from "../shared.ts";

function sendError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "offline") return "You're offline, so the message wasn't sent.";
  if (error instanceof ApiError && error.kind === "signed_out") return "You're signed out. Sign in again, then resend.";
  return "Couldn't send. Try again.";
}

/** Talks to the coach about today. Voice works through the keyboard's microphone. */
export function Composer() {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: (body: MessageInput) => api<MessageResult>("/api/messages", { json: body }),
    onSuccess: (result) => {
      storeDay(client, result.day);
      setText("");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    send.mutate({ id: crypto.randomUUID(), sent_at: new Date().toISOString(), text: trimmed });
  }

  return (
    <form
      onSubmit={submit}
      className="fixed inset-x-0 bottom-[calc(3rem_+_env(safe-area-inset-bottom))] z-10 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="mx-auto flex max-w-xl items-end gap-2">
        <textarea
          aria-label="Message your coach"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What did you eat or do?"
          className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={send.isPending || !text.trim()}
          className="h-11 rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-40"
        >
          {send.isPending ? "…" : "Send"}
        </button>
      </div>
      {send.isError && (
        <p role="alert" className="mx-auto mt-1 max-w-xl text-sm text-red-600">
          {sendError(send.error)}
        </p>
      )}
    </form>
  );
}
```

`web/src/components/SetupPrompt.tsx`:

```tsx
import { Link } from "react-router";

export function SetupPrompt() {
  return (
    <main className="mx-auto max-w-xl p-6 pt-[calc(env(safe-area-inset-top)_+_1.5rem)]">
      <h1 className="text-xl font-semibold">Welcome</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">Set up your profile so the app can work out your daily targets.</p>
      <Link to="/settings" className="mt-4 inline-block rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white">
        Set up profile
      </Link>
    </main>
  );
}
```

Replace `web/src/pages/TodayPage.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api.ts";
import { Composer } from "../components/Composer.tsx";
import { DayNav } from "../components/DayNav.tsx";
import { Feed } from "../components/Feed.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { Summary } from "../components/Summary.tsx";
import { storeDay, useDay } from "../queries.ts";
import type { DeleteResult, MessageResult } from "../shared.ts";

export function TodayPage() {
  const { date = "today" } = useParams();
  const day = useDay(date);
  const client = useQueryClient();
  const [logOnly, setLogOnly] = useState(false);
  const retry = useMutation({
    mutationFn: (id: string) => api<MessageResult>(`/api/messages/${id}/retry`, { method: "POST" }),
    onSuccess: (result) => storeDay(client, result.day),
  });
  const undo = useMutation({
    mutationFn: async (ids: string[]) => {
      let last: DeleteResult | null = null;
      for (const id of ids) last = await api<DeleteResult>(`/api/entries/${id}`, { method: "DELETE" });
      return last;
    },
    onSuccess: (last) => {
      if (last) storeDay(client, last.day);
    },
  });

  if (day.error instanceof ApiError && day.error.code === "no_profile") return <SetupPrompt />;
  if (!day.data) {
    return <main className="mx-auto max-w-xl p-6 text-slate-500">{day.isError ? "Couldn't load this day." : "Loading…"}</main>;
  }
  const view = day.data;
  return (
    <main className="mx-auto max-w-xl pb-48">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <DayNav date={view.date} today={view.today} />
        <Summary view={view} />
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-500">
          <input type="checkbox" checked={logOnly} onChange={(event) => setLogOnly(event.target.checked)} />
          Log only
        </label>
      </header>
      <Feed view={view} logOnly={logOnly} onRetry={(id) => retry.mutate(id)} onUndo={(ids) => undo.mutate(ids)} />
      {view.date === view.today && <Composer />}
    </main>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w web && npm run typecheck && npm run lint`
Expected: the web suites pass (`DayNav` 3, `Summary` 1, `Feed` 4, `Composer` 2, `api` 6); no errors.

- [ ] **Step 5: Try it in a browser**

Run `npm run dev:server` and `npm run dev:web` in two terminals, open the URL Vite prints (`http://localhost:5173`). Expected: the "Welcome — Set up profile" screen (no profile yet). The Settings stand-in comes in Task 21; to see the Today screen now, create a profile from a third terminal:

```bash
curl -s -X PUT localhost:8080/api/profile -H 'content-type: application/json' \
  -d '{"sex":"male","birth_date":"1991-03-15","height_cm":180,"weight_kg":80,"activity_level":"light","goal":"lose","goal_rate_kg_week":0.5}'
```

Reload: the Today screen shows `0 / 1860 kcal`, empty bars, the "Nothing logged yet" note and the composer. ‹ goes to yesterday, › comes back. With `ANTHROPIC_API_KEY` exported in the server's terminal, "2 eggs on toast" is logged as a card under the coach's reply; without one, the message shows "The coach is switched off" with Retry. Stop both servers and `rm -rf .data`.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): Today screen with day navigation, summary, feed and composer"
```

---

### Task 20: Editing, deleting and adding entries by hand

**Files:**
- Create: `web/src/components/EntryEditor.tsx`
- Modify: `web/src/pages/TodayPage.tsx`
- Test: `web/src/components/EntryEditor.test.tsx`

**Interfaces:**
- Consumes: `api`, `storeDay`, `EXERCISE_CATEGORIES`, `Entry`, `EntryResult`, `DeleteResult`, `FoodItemInput`, `ExerciseItemInput` (shared).
- Produces: `<EntryEditor date entry={Entry | null} onClose />` — `entry: null` adds a manual entry (POST `/api/entries`), otherwise edits (PATCH) or deletes (DELETE after `window.confirm`). Fields it does not show (food groups, saturated fat, assumptions, muscles…) are sent back unchanged. Exports `toFoodInput`, `toExerciseInput`, `blankFood`, `blankExercise`.

- [ ] **Step 1: Write the failing test**

`web/src/components/EntryEditor.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { EntryEditor } from "./EntryEditor.tsx";

describe("EntryEditor", () => {
  it("saves edited numbers with a PATCH that keeps the fields it does not show", async () => {
    const sample = entry();
    const fetchMock = mockFetch(() => jsonResponse({ entry: sample, day: dayView({ entries: [sample] }) }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={sample} onClose={onClose} />);

    const kcal = screen.getByLabelText("kcal");
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "350");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entries/e1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body)).foods[0]).toMatchObject({
      name: "Porridge", kcal: 350, saturated_fat_g: 1.5, groups: [{ group: "wholegrains", portions: 1 }],
    });
  });

  it("deletes after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetch(() => jsonResponse({ day: dayView() }));
    const onClose = vi.fn();
    renderWithProviders(<EntryEditor date="2026-10-03" entry={entry()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("adds a manual entry with a POST", async () => {
    const created = entry({ id: "new" });
    const fetchMock = mockFetch(() => jsonResponse({ entry: created, day: dayView({ entries: [created] }) }, 201));
    renderWithProviders(<EntryEditor date="2026-10-02" entry={null} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Food"), "Apple");
    await userEvent.type(screen.getByLabelText("kcal"), "52");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entries");
    expect(JSON.parse(String(init?.body))).toMatchObject({ date: "2026-10-02", time: null, foods: [{ name: "Apple", kcal: 52 }], exercises: [] });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w web`
Expected: FAIL — `Failed to load url ./EntryEditor.tsx`.

- [ ] **Step 3: Implement**

`web/src/components/EntryEditor.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";
import { storeDay } from "../queries.ts";
import { EXERCISE_CATEGORIES } from "../shared.ts";
import type {
  DeleteResult, Entry, EntryResult, ExerciseCategory, ExerciseItem, ExerciseItemInput, FoodItem, FoodItemInput,
} from "../shared.ts";

export function toFoodInput(f: FoodItem): FoodItemInput {
  return {
    name: f.name, quantity: f.quantity, grams: f.grams, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g,
    fat_g: f.fat_g, fibre_g: f.fibre_g, saturated_fat_g: f.saturated_fat_g, sugars_g: f.sugars_g, salt_g: f.salt_g,
    fluid_ml: f.fluid_ml, alcohol_units: f.alcohol_units, assumption: f.assumption, groups: f.groups,
  };
}

export function toExerciseInput(x: ExerciseItem): ExerciseItemInput {
  return {
    name: x.name, category: x.category, duration_min: x.duration_min, sets: x.sets, reps: x.reps,
    weight_kg: x.weight_kg, distance_km: x.distance_km, avg_hr: x.avg_hr, met: x.met, kcal: x.kcal,
    assumption: x.assumption, muscles: x.muscles,
  };
}

export const blankFood = (): FoodItemInput => ({
  name: "", quantity: "", grams: null, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0,
  saturated_fat_g: 0, sugars_g: 0, salt_g: 0, fluid_ml: 0, alcohol_units: 0, assumption: "", groups: [],
});

export const blankExercise = (): ExerciseItemInput => ({
  name: "", category: "cardio", duration_min: null, sets: null, reps: null, weight_kg: null,
  distance_km: null, avg_hr: null, met: null, kcal: 0, assumption: "", muscles: [],
});

const inputClass = "mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-base dark:border-slate-700 dark:bg-slate-950";
const rowClass = "mt-3 rounded-xl border border-slate-200 p-2 dark:border-slate-700";

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="flex min-w-0 flex-col text-xs">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className={inputClass}
      />
    </label>
  );
}

function FoodRow({ food, onChange, onRemove }: { food: FoodItemInput; onChange: (food: FoodItemInput) => void; onRemove: () => void }) {
  const set = (patch: Partial<FoodItemInput>) => onChange({ ...food, ...patch });
  return (
    <div className={rowClass}>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col text-xs">
          Food
          <input value={food.name} onChange={(event) => set({ name: event.target.value })} className={inputClass} />
        </label>
        <label className="flex w-28 flex-col text-xs">
          Amount
          <input value={food.quantity} onChange={(event) => set({ quantity: event.target.value })} className={inputClass} />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        <NumberField label="kcal" value={food.kcal} onChange={(v) => set({ kcal: v ?? 0 })} />
        <NumberField label="Protein" value={food.protein_g} onChange={(v) => set({ protein_g: v ?? 0 })} />
        <NumberField label="Carbs" value={food.carbs_g} onChange={(v) => set({ carbs_g: v ?? 0 })} />
        <NumberField label="Fat" value={food.fat_g} onChange={(v) => set({ fat_g: v ?? 0 })} />
        <NumberField label="Fibre" value={food.fibre_g} onChange={(v) => set({ fibre_g: v ?? 0 })} />
      </div>
      <button type="button" onClick={onRemove} className="mt-1 text-xs text-slate-500">
        Remove
      </button>
    </div>
  );
}

function ExerciseRow({ item, onChange, onRemove }: { item: ExerciseItemInput; onChange: (item: ExerciseItemInput) => void; onRemove: () => void }) {
  const set = (patch: Partial<ExerciseItemInput>) => onChange({ ...item, ...patch });
  return (
    <div className={rowClass}>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col text-xs">
          Exercise
          <input value={item.name} onChange={(event) => set({ name: event.target.value })} className={inputClass} />
        </label>
        <label className="flex w-28 flex-col text-xs">
          Type
          <select value={item.category} onChange={(event) => set({ category: event.target.value as ExerciseCategory })} className={inputClass}>
            {EXERCISE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField label="Minutes" value={item.duration_min} onChange={(v) => set({ duration_min: v })} />
        <NumberField label="kcal burned" value={item.kcal} onChange={(v) => set({ kcal: v })} />
      </div>
      <button type="button" onClick={onRemove} className="mt-1 text-xs text-slate-500">
        Remove
      </button>
    </div>
  );
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

export function EntryEditor({ date, entry, onClose }: { date: string; entry: Entry | null; onClose: () => void }) {
  const client = useQueryClient();
  const [foods, setFoods] = useState<FoodItemInput[]>(() => (entry ? entry.foods.map(toFoodInput) : [blankFood()]));
  const [exercises, setExercises] = useState<ExerciseItemInput[]>(() => (entry ? entry.exercises.map(toExerciseInput) : []));

  const save = useMutation({
    mutationFn: () => {
      const items = { foods: foods.filter((f) => f.name.trim()), exercises: exercises.filter((x) => x.name.trim()) };
      return entry
        ? api<EntryResult>(`/api/entries/${entry.id}`, { method: "PATCH", json: items })
        : api<EntryResult>("/api/entries", { json: { id: crypto.randomUUID(), date, time: null, ...items } });
    },
    onSuccess: (result) => {
      storeDay(client, result.day);
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<DeleteResult>(`/api/entries/${id}`, { method: "DELETE" }),
    onSuccess: (result) => {
      storeDay(client, result.day);
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={entry ? "Edit entry" : "Add manually"} className="fixed inset-0 z-40 flex items-end bg-black/40 sm:items-center">
      <form
        onSubmit={submit}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:mx-auto sm:max-w-xl sm:rounded-2xl dark:bg-slate-900"
      >
        <h2 className="text-lg font-semibold">{entry ? "Edit entry" : "Add manually"}</h2>
        {foods.map((food, i) => (
          <FoodRow key={`f${i}`} food={food} onChange={(next) => setFoods(replaceAt(foods, i, next))} onRemove={() => setFoods(foods.filter((_, j) => j !== i))} />
        ))}
        {exercises.map((item, i) => (
          <ExerciseRow
            key={`x${i}`}
            item={item}
            onChange={(next) => setExercises(replaceAt(exercises, i, next))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
          />
        ))}
        <div className="mt-3 flex gap-4 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <button type="button" onClick={() => setFoods([...foods, blankFood()])}>
            + Food
          </button>
          <button type="button" onClick={() => setExercises([...exercises, blankExercise()])}>
            + Exercise
          </button>
        </div>
        {(save.isError || remove.isError) && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            Couldn't save. Check every item has a name and the numbers are not negative.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          {entry ? (
            <button
              type="button"
              className="text-red-600"
              onClick={() => {
                if (window.confirm("Delete this entry?")) remove.mutate(entry.id);
              }}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2">
              Cancel
            </button>
            <button type="submit" disabled={save.isPending} className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
```

Replace `web/src/pages/TodayPage.tsx` with the version that opens the editor:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { ApiError, api } from "../api.ts";
import { Composer } from "../components/Composer.tsx";
import { DayNav } from "../components/DayNav.tsx";
import { EntryEditor } from "../components/EntryEditor.tsx";
import { Feed } from "../components/Feed.tsx";
import { SetupPrompt } from "../components/SetupPrompt.tsx";
import { Summary } from "../components/Summary.tsx";
import { storeDay, useDay } from "../queries.ts";
import type { DeleteResult, Entry, MessageResult } from "../shared.ts";

export function TodayPage() {
  const { date = "today" } = useParams();
  const day = useDay(date);
  const client = useQueryClient();
  const [logOnly, setLogOnly] = useState(false);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const retry = useMutation({
    mutationFn: (id: string) => api<MessageResult>(`/api/messages/${id}/retry`, { method: "POST" }),
    onSuccess: (result) => storeDay(client, result.day),
  });
  const undo = useMutation({
    mutationFn: async (ids: string[]) => {
      let last: DeleteResult | null = null;
      for (const id of ids) last = await api<DeleteResult>(`/api/entries/${id}`, { method: "DELETE" });
      return last;
    },
    onSuccess: (last) => {
      if (last) storeDay(client, last.day);
    },
  });

  if (day.error instanceof ApiError && day.error.code === "no_profile") return <SetupPrompt />;
  if (!day.data) {
    return <main className="mx-auto max-w-xl p-6 text-slate-500">{day.isError ? "Couldn't load this day." : "Loading…"}</main>;
  }
  const view = day.data;
  return (
    <main className="mx-auto max-w-xl pb-48">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <DayNav date={view.date} today={view.today} />
        <Summary view={view} />
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-500">
          <input type="checkbox" checked={logOnly} onChange={(event) => setLogOnly(event.target.checked)} />
          Log only
        </label>
      </header>
      <Feed view={view} logOnly={logOnly} onRetry={(id) => retry.mutate(id)} onEdit={setEditing} onUndo={(ids) => undo.mutate(ids)} />
      <div className="px-4">
        <button type="button" onClick={() => setEditing("new")} className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          + Add manually
        </button>
      </div>
      {view.date === view.today && <Composer />}
      {editing && <EntryEditor date={view.date} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w web && npm run typecheck && npm run lint`
Expected: `EntryEditor.test.tsx` 3 tests pass with the rest; no errors.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): edit, delete and add entries by hand"
```

---

### Task 21: Settings — the profile form

**Files:**
- Replace: `web/src/pages/SettingsPage.tsx`
- Test: `web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`, `kcal10`, `ACTIVITY_LEVEL_KEYS`, `BODY_GOALS`, `SEXES`, `ProfileView`, `ProfileInput`, `Profile`, `MacroTargets`.
- Produces: `<SettingsPage />` — loads `GET /api/profile` (a `no_profile` answer means an empty form), saves with `PUT /api/profile`, shows each calculated target as the placeholder of its override field, and marks every cached day stale after saving. Settings it does not show yet (units, coach options, body-goal priority) are sent back unchanged.

- [ ] **Step 1: Write the failing test**

`web/src/pages/SettingsPage.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

const HIDDEN_SETTINGS = { body_goal_priority: "high", units_mass: "kg", units_length: "cm", context_days: 5, goal_notes: "on" };

describe("SettingsPage", () => {
  it("creates the profile with a PUT, then shows the calculated calories", async () => {
    const puts: unknown[] = [];
    mockFetch((_url, init) => {
      if (init?.method !== "PUT") return jsonResponse({ error: "no_profile" }, 404);
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return jsonResponse({ profile: { ...HIDDEN_SETTINGS, ...body }, calculated: { kcal: 1863.125, protein_g: 144, carbs_g: 182, fat_g: 62, fibre_g: 30 } });
    });
    renderWithProviders(<SettingsPage />);

    fireEvent.change(await screen.findByLabelText("Birth date"), { target: { value: "1991-03-15" } });
    await userEvent.type(screen.getByLabelText("Height (cm)"), "180");
    await userEvent.type(screen.getByLabelText("Weight (kg)"), "80");
    await userEvent.selectOptions(screen.getByLabelText("Goal"), "lose");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(puts[0]).toMatchObject({
      sex: "male", birth_date: "1991-03-15", height_cm: 180, weight_kg: 80, activity_level: "light",
      goal: "lose", goal_rate_kg_week: 0.5, override_kcal: null, timezone: "Europe/London",
    });
    expect(screen.getByPlaceholderText("1860 kcal calculated")).toBeInTheDocument();
  });

  it("loads an existing profile into the form", async () => {
    mockFetch(() =>
      jsonResponse({
        profile: {
          ...HIDDEN_SETTINGS, sex: "female", birth_date: "1990-05-01", height_cm: 165, weight_kg: 60,
          activity_level: "moderate", goal: "maintain", goal_rate_kg_week: 0, protein_g_per_kg: 1.6, fat_pct: 30,
          fibre_g: 30, add_back_pct: 50, override_kcal: 2000, override_protein_g: null, override_carbs_g: null,
          override_fat_g: null, override_fibre_g: null, timezone: "Europe/London",
        },
        calculated: { kcal: 2100, protein_g: 96, carbs_g: 250, fat_g: 70, fibre_g: 30 },
      }),
    );
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByDisplayValue("1990-05-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Calories override")).toHaveValue(2000);
    expect(screen.queryByLabelText("Rate (kg per week)")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -w web`
Expected: FAIL — the stand-in page has no "Birth date" field (`Unable to find a label with the text of: Birth date`).

- [ ] **Step 3: Implement**

Replace `web/src/pages/SettingsPage.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ApiError, api } from "../api.ts";
import { kcal10 } from "../format.ts";
import { ACTIVITY_LEVEL_KEYS, BODY_GOALS, SEXES } from "../shared.ts";
import type { MacroTargets, Profile, ProfileInput, ProfileView } from "../shared.ts";

const FIELDS = [
  "sex", "birth_date", "height_cm", "weight_kg", "activity_level", "goal", "goal_rate_kg_week",
  "protein_g_per_kg", "fat_pct", "fibre_g", "add_back_pct", "override_kcal", "override_protein_g",
  "override_carbs_g", "override_fat_g", "override_fibre_g", "timezone",
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const EMPTY: Form = {
  sex: "male", birth_date: "", height_cm: "", weight_kg: "", activity_level: "light", goal: "maintain",
  goal_rate_kg_week: "0.5", protein_g_per_kg: "1.8", fat_pct: "30", fibre_g: "30", add_back_pct: "50",
  override_kcal: "", override_protein_g: "", override_carbs_g: "", override_fat_g: "", override_fibre_g: "",
  timezone: "Europe/London",
};

function formFrom(profile: Profile): Form {
  const form = { ...EMPTY };
  for (const field of FIELDS) {
    const value = profile[field];
    form[field] = value === null ? "" : String(value);
  }
  return form;
}

function payloadFrom(form: Form, previous: Profile | null): ProfileInput {
  const number = (field: Field) => Number(form[field]);
  const optional = (field: Field) => (form[field].trim() === "" ? null : Number(form[field]));
  return {
    ...previous, // keeps the settings this screen does not show yet
    sex: form.sex as Profile["sex"],
    birth_date: form.birth_date,
    height_cm: number("height_cm"),
    weight_kg: number("weight_kg"),
    activity_level: form.activity_level as Profile["activity_level"],
    goal: form.goal as Profile["goal"],
    goal_rate_kg_week: form.goal === "maintain" ? 0 : number("goal_rate_kg_week"),
    protein_g_per_kg: number("protein_g_per_kg"),
    fat_pct: number("fat_pct"),
    fibre_g: number("fibre_g"),
    add_back_pct: number("add_back_pct"),
    override_kcal: optional("override_kcal"),
    override_protein_g: optional("override_protein_g"),
    override_carbs_g: optional("override_carbs_g"),
    override_fat_g: optional("override_fat_g"),
    override_fibre_g: optional("override_fibre_g"),
    timezone: form.timezone.trim(),
  };
}

async function loadProfile(): Promise<ProfileView | null> {
  try {
    return await api<ProfileView>("/api/profile");
  } catch (error) {
    if (error instanceof ApiError && error.code === "no_profile") return null;
    throw error;
  }
}

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      {label}
      <input {...input} className={inputClass} />
    </label>
  );
}

function SelectField({ label, options, ...select }: { label: string; options: readonly string[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block text-sm">
      {label}
      <select {...select} className={inputClass}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsPage() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: loadProfile });
  const [form, setForm] = useState<Form>(EMPTY);
  const [calculated, setCalculated] = useState<MacroTargets | null>(null);

  useEffect(() => {
    if (profile.data) {
      setForm(formFrom(profile.data.profile));
      setCalculated(profile.data.calculated);
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api<ProfileView>("/api/profile", { method: "PUT", json: payloadFrom(form, profile.data?.profile ?? null) }),
    onSuccess: (view) => {
      client.setQueryData(["profile"], view);
      setCalculated(view.calculated);
      void client.invalidateQueries({ queryKey: ["day"] });
    },
  });

  const bind = (field: Field) => ({
    value: form[field],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: event.target.value }),
  });
  const hint = (key: keyof MacroTargets, unit: string) =>
    calculated ? `${key === "kcal" ? kcal10(calculated.kcal) : Math.round(calculated[key])} ${unit} calculated` : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  if (profile.isPending) return <main className="p-6 text-slate-500">Loading…</main>;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
      <h1 className="text-xl font-semibold">Settings</h1>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-6">
        <Section title="About you">
          <SelectField label="Sex" options={SEXES} {...bind("sex")} />
          <TextField label="Birth date" type="date" required {...bind("birth_date")} />
          <TextField label="Height (cm)" type="number" step="0.1" required {...bind("height_cm")} />
          <TextField label="Weight (kg)" type="number" step="0.1" required {...bind("weight_kg")} />
          <SelectField label="Everyday activity, excluding workouts" options={ACTIVITY_LEVEL_KEYS} {...bind("activity_level")} />
        </Section>
        <Section title="Body goal">
          <SelectField label="Goal" options={BODY_GOALS} {...bind("goal")} />
          {form.goal !== "maintain" && <TextField label="Rate (kg per week)" type="number" step="0.05" {...bind("goal_rate_kg_week")} />}
        </Section>
        <Section title="Targets">
          <TextField label="Protein (g per kg)" type="number" step="0.1" {...bind("protein_g_per_kg")} />
          <TextField label="Fat (% of calories)" type="number" {...bind("fat_pct")} />
          <TextField label="Fibre (g)" type="number" {...bind("fibre_g")} />
          <TextField label="Exercise calories added back (%)" type="number" {...bind("add_back_pct")} />
          <p className="text-xs text-slate-500">An override replaces the calculated value. Leave it blank to use the calculation.</p>
          <TextField label="Calories override" type="number" placeholder={hint("kcal", "kcal")} {...bind("override_kcal")} />
          <TextField label="Protein override (g)" type="number" placeholder={hint("protein_g", "g")} {...bind("override_protein_g")} />
          <TextField label="Carbs override (g)" type="number" placeholder={hint("carbs_g", "g")} {...bind("override_carbs_g")} />
          <TextField label="Fat override (g)" type="number" placeholder={hint("fat_g", "g")} {...bind("override_fat_g")} />
          <TextField label="Fibre override (g)" type="number" placeholder={hint("fibre_g", "g")} {...bind("override_fibre_g")} />
        </Section>
        <Section title="Time">
          <TextField label="Timezone" {...bind("timezone")} />
        </Section>
        {save.isError && (
          <p role="alert" className="text-sm text-red-600">
            Couldn't save. Check that every value is filled in and in range.
          </p>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-emerald-700">
            Saved.
          </p>
        )}
        <button type="submit" disabled={save.isPending} className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-40">
          Save
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all shared, server and web suites pass; no type or lint errors; the build succeeds.

- [ ] **Step 5: Try the whole flow locally**

With `npm run dev:server` and `npm run dev:web` running, open `http://localhost:5173`: Welcome → Set up profile → fill in and Save → "Saved." with calculated values in the override placeholders → Today shows the targets → add an entry with "+ Add manually", edit it, delete it. Stop both servers and `rm -rf .data`.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): profile settings with calculated targets beside the overrides"
```

---

### Task 22: The container image

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Produces: an image that runs `node server/src/main.ts` as user `node` (uid 1000) on ports 8080 (app) and 9464 (metrics), with `NODE_ENV=production`, `DATA_DIR=/data`, `WEB_DIST=/app/web/dist` baked in. CI (Task 25) builds it for `linux/arm64`.

- [ ] **Step 1: Write the files**

`.dockerignore`:

```
**/node_modules
.git
.github
.data
docs
k8s
web/dist
web/dev-dist
**/test
**/*.test.ts
**/*.test.tsx
*.md
```

`Dockerfile`:

```dockerfile
# ---- build: install everything, build the PWA, then drop dev dependencies ----
FROM node:24-slim AS build
WORKDIR /app
# better-sqlite3 normally downloads a prebuilt binary; the toolchain is the fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime: Node runs the server's TypeScript directly (type stripping) ----
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    METRICS_PORT=9464 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/src server/src
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080 9464
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
```

- [ ] **Step 2: Build and boot it locally**

If Docker is not installed on this machine, or its daemon cannot pull `node:24-slim` from Docker Hub (`docker pull node:24-slim` hangs or fails), skip this step: the `image` job in Task 25 runs the same checks in CI.

```bash
docker build -t fitnessai:dev .
docker run --rm -d --name fitnessai-dev -p 8080:8080 --tmpfs /data:uid=1000,gid=1000 \
  -e ACCESS_TEAM_DOMAIN=local.example.cloudflareaccess.com -e ACCESS_AUD=local -e OWNER_EMAIL=local@example.com \
  fitnessai:dev
curl -s localhost:8080/api/health
curl -s localhost:8080/day/today | grep -c 'id="root"'
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/profile
docker rm -f fitnessai-dev
```

Expected: `{"ok":true}`, then `1` (the PWA is served), then `401` (the API refuses requests without an Access token). If the container exits instead, `docker logs fitnessai-dev` shows why — a missing file in the image is the usual cause; add it to the runtime `COPY` lines.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: container image that runs the server's TypeScript directly"
```

---

### Task 23: home-cluster — the Access application and the Flux wiring (branch only)

This task edits **the owner's existing clone of `yanbin-pan/home-cluster`** (it holds the gitignored `terraform.tfvars` and the Terraform state). Ask the owner for its path; it is usually `~/Repositories/home-cluster`. Nothing is pushed or merged here: the Flux file must not reach `main` until the app's image exists (Task 26).

**Files (in home-cluster):**
- Modify: `terraform/cloudflare/access.tf`, `terraform/cloudflare/outputs.tf`
- Create: `clusters/home/fitnessai.yaml`

**Interfaces:**
- Produces: a Cloudflare Access application for `fitness.minipi.net` (one-time PIN, 30-day session, `fitness_emails` only) and the Terraform output `fitness_aud` — the 64-character audience tag that becomes `ACCESS_AUD` in Task 24.

- [ ] **Step 1: Branch**

```bash
cd ~/Repositories/home-cluster   # the owner's clone
git switch main && git pull
git switch -c fitnessai
```

- [ ] **Step 2: Terraform**

Append to `terraform/cloudflare/access.tf`:

```hcl
# fitnessAI is a single-person app, so it gets its own list rather than reusing
# admin_emails or tea_cabinet_emails: adding someone to either can never let them in here.
variable "fitness_emails" {
  type        = list(string)
  description = "Emails allowed into fitnessAI (just the owner)"
}

resource "cloudflare_zero_trust_access_policy" "fitness" {
  count      = var.access_enabled ? 1 : 0
  account_id = var.account_id
  name       = "Allow fitnessAI owner"
  decision   = "allow"

  include = [for e in var.fitness_emails : { email = { email = e } }]
}

# Gates the whole hostname, so it also covers the API the PWA calls. The app
# verifies the signed assertion itself too and admits only OWNER_EMAIL.
resource "cloudflare_zero_trust_access_application" "fitness" {
  count      = var.access_enabled ? 1 : 0
  account_id = var.account_id
  name       = "fitnessAI"
  domain     = "fitness.${var.domain}"
  type       = "self_hosted"

  # 30 days: an installed phone app that asked for a PIN every day would be unusable.
  session_duration = "720h"

  allowed_idps              = [cloudflare_zero_trust_access_identity_provider.otp[0].id]
  auto_redirect_to_identity = true

  policies = [{
    id         = cloudflare_zero_trust_access_policy.fitness[0].id
    precedence = 1
  }]
}
```

Append to `terraform/cloudflare/outputs.tf`:

```hcl
# fitnessAI verifies the Access assertion itself and checks this value as the
# token's `aud` claim, so it is copied into the app's deployment as ACCESS_AUD.
# An identifier, not a secret. It changes if the application is ever recreated.
output "fitness_aud" {
  value       = var.access_enabled ? cloudflare_zero_trust_access_application.fitness[0].aud : null
  description = "Audience tag for the fitnessAI Access application (set as ACCESS_AUD)"
}
```

Run: `terraform -chdir=terraform/cloudflare fmt && terraform -chdir=terraform/cloudflare validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: The Flux wiring**

`clusters/home/fitnessai.yaml`:

```yaml
# fitnessAI lives in its own repository and owns its manifests, so Flux watches
# that repository directly — the same pattern as tea-cabinet.yaml. This file is
# the only thing home-cluster needs for the app.
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: fitnessai
  namespace: flux-system
spec:
  # Public repository, so no deploy key is needed over HTTPS.
  url: https://github.com/yanbin-pan/fitnessAI
  ref:
    branch: main
  interval: 1m
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: fitnessai
  namespace: flux-system
spec:
  interval: 10m
  path: ./k8s
  prune: true
  sourceRef:
    kind: GitRepository
    name: fitnessai
  # Without this the PVC can be created before the ssd StorageClass exists.
  dependsOn:
    - name: infrastructure
  # The app commits its Secret SOPS-encrypted to this cluster's age key. Removing
  # this block does not fail loudly: the Secret would arrive still encrypted.
  decryption:
    provider: sops
    secretRef:
      name: sops-age
  # Report Ready only once the Deployment has rolled out.
  wait: true
  timeout: 5m
```

- [ ] **Step 4: Commit on the branch (do not push)**

```bash
git add terraform/cloudflare/access.tf terraform/cloudflare/outputs.tf clusters/home/fitnessai.yaml
git commit -m "Add fitnessAI: Access application and Flux wiring"
```

- [ ] **Step 5: OWNER — apply the Terraform**

Ask the owner to:
1. Add the email they sign in to Cloudflare Access with to `terraform/cloudflare/terraform.tfvars`:
   ```hcl
   fitness_emails = ["you@example.com"]
   ```
2. Run `terraform -chdir=terraform/cloudflare plan` — expect `2 to add` (the policy and the application) and nothing changed or destroyed.
3. Run `terraform -chdir=terraform/cloudflare apply`.
4. Run `terraform -chdir=terraform/cloudflare output -raw fitness_aud` and share the value — 64 hexadecimal characters. It is not a secret.

---

### Task 24: Kubernetes manifests and the encrypted Secret

**Files:**
- Create: `.sops.yaml`, `k8s/00-namespace.yaml`, `k8s/10-pvc.yaml`, `k8s/30-app.yaml`, `k8s/50-ingress.yaml`, `k8s/60-rate-limits.yaml`, `k8s/kustomization.yaml`
- Create (OWNER): `k8s/80-secrets.sops.yaml`

**Interfaces:**
- Consumes: the `fitness_aud` value from Task 23 Step 5; the image name `ghcr.io/yanbin-pan/fitnessai` (Task 25 pushes it).
- Produces: namespace `fitnessai`; PVC `fitnessai-data`; Deployment and Service `fitnessai`; Ingresses for `fitness.minipi.net` (`/` and `/api/messages`); Middlewares `rate-limit` and `coach-rate-limit`; Secret `fitnessai-secrets` (`ANTHROPIC_API_KEY`, `OWNER_EMAIL`).

- [ ] **Step 1: SOPS configuration**

`.sops.yaml` (the age **public** key, the same one home-cluster and tea-cabinet use):

```yaml
# Secrets here are committed encrypted and decrypted in the cluster by Flux,
# which holds the private key. This is an age PUBLIC key: safe to commit.
creation_rules:
  # Encrypt only data/stringData so metadata stays readable and diffs reviewable.
  - path_regex: .*\.sops\.ya?ml$
    encrypted_regex: ^(data|stringData)$
    age: age1r8ph8yhw6ulpntwa34jn9k9xj6jdkw96afrtuh5wr3pt8cj0d4vq4e286m
```

- [ ] **Step 2: The manifests**

`k8s/00-namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: fitnessai
```

`k8s/10-pvc.yaml`:

```yaml
# ssd is the NFS-backed class on rpi-01's SSD, backed up nightly to R2.
# ReadWriteOnce together with strategy: Recreate guarantees one pod per SQLite
# file: two writers over NFS would corrupt it (spec §14.4).
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: fitnessai-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ssd
  resources:
    requests:
      storage: 2Gi
```

`k8s/30-app.yaml` (`__FITNESS_AUD__` is replaced in Step 3):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fitnessai
  labels:
    app: fitnessai
spec:
  replicas: 1
  # Recreate, never RollingUpdate: a rolling update would briefly run two pods
  # holding the same SQLite file.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: fitnessai
  template:
    metadata:
      labels:
        app: fitnessai
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9464"
        prometheus.io/path: /metrics
    spec:
      # Lets an in-flight coach message (up to 90 s) finish during a deploy.
      terminationGracePeriodSeconds: 100
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: fitnessai
          image: ghcr.io/yanbin-pan/fitnessai:latest
          ports:
            - name: http
              containerPort: 8080
            - name: metrics
              containerPort: 9464
          env:
            - name: NODE_ENV
              value: production
            - name: PORT
              value: "8080"
            - name: METRICS_PORT
              value: "9464"
            - name: DATA_DIR
              value: /data
            - name: WEB_DIST
              value: /app/web/dist
            # The app verifies the Access assertion itself and refuses to start
            # without these. ACCESS_AUD is an identifier, not a secret.
            - name: ACCESS_TEAM_DOMAIN
              value: jolly-fire-e5fd.cloudflareaccess.com
            - name: ACCESS_AUD
              value: "__FITNESS_AUD__"
            - name: OWNER_EMAIL
              valueFrom:
                secretKeyRef:
                  name: fitnessai-secrets
                  key: OWNER_EMAIL
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: fitnessai-secrets
                  key: ANTHROPIC_API_KEY
                  optional: true
            - name: ANTHROPIC_MODEL
              value: claude-opus-5-5
            - name: ANTHROPIC_EFFORT
              value: medium
            - name: SNAPSHOT_KEEP
              value: "7"
          volumeMounts:
            - name: data
              mountPath: /data
            - name: tmp
              mountPath: /tmp
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          # Three minutes for the database lock a crashed predecessor may still hold (spec §14.4).
          startupProbe:
            httpGet:
              path: /api/health
              port: http
            periodSeconds: 5
            failureThreshold: 36
          readinessProbe:
            httpGet:
              path: /api/health
              port: http
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: http
            periodSeconds: 20
            failureThreshold: 3
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 384Mi
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: fitnessai-data
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: fitnessai
spec:
  selector:
    app: fitnessai
  # Only the app port: metrics are scraped from the pod and never routed.
  ports:
    - name: http
      port: 8080
      targetPort: http
```

`k8s/50-ingress.yaml`:

```yaml
# TLS ends at Cloudflare, so Traefik listens on plain HTTP inside the cluster.
# Two Ingress objects because Traefik attaches middlewares per Ingress, not per
# path; Traefik prefers the longer path, so /api/messages gets the coach limit.
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fitnessai
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
    traefik.ingress.kubernetes.io/router.middlewares: fitnessai-rate-limit@kubernetescrd
spec:
  ingressClassName: traefik
  rules:
    - host: fitness.minipi.net
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: fitnessai
                port:
                  number: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fitnessai-coach
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
    traefik.ingress.kubernetes.io/router.middlewares: fitnessai-coach-rate-limit@kubernetescrd
spec:
  ingressClassName: traefik
  rules:
    - host: fitness.minipi.net
      http:
        paths:
          - path: /api/messages
            pathType: Prefix
            backend:
              service:
                name: fitnessai
                port:
                  number: 8080
```

`k8s/60-rate-limits.yaml`:

```yaml
# Per client. Behind Cloudflare and the tunnel the source address Traefik sees is
# an internal pod address; the real client survives only in Cf-Connecting-Ip,
# which Cloudflare overwrites on every request, so it cannot be spoofed.
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: rate-limit
spec:
  rateLimit:
    average: 120
    period: 1m
    burst: 60
    sourceCriterion:
      requestHeaderName: Cf-Connecting-Ip
---
# Every coach message is up to five Claude calls, so this is the cost guard
# against a runaway client (spec §6.4).
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: coach-rate-limit
spec:
  rateLimit:
    average: 20
    period: 1m
    burst: 10
    sourceCriterion:
      requestHeaderName: Cf-Connecting-Ip
```

`k8s/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: fitnessai

resources:
  - 00-namespace.yaml
  - 10-pvc.yaml
  - 30-app.yaml
  - 50-ingress.yaml
  - 60-rate-limits.yaml
  - 80-secrets.sops.yaml

# newTag IS WRITTEN BY CI: .github/workflows/ci.yaml pins the commit it just built,
# so a deploy is reproducible and a rollback is a plain `git revert`.
images:
  - name: ghcr.io/yanbin-pan/fitnessai
    newTag: latest
```

- [ ] **Step 3: Fill in the audience tag**

Replace `__FITNESS_AUD__` in `k8s/30-app.yaml` with the value from Task 23 Step 5, then check it:

```bash
grep -A1 'name: ACCESS_AUD' k8s/30-app.yaml
```

Expected: `value: "<64 hexadecimal characters>"` — and no `__FITNESS_AUD__` left anywhere (`grep -r __FITNESS_AUD__ k8s` prints nothing).

- [ ] **Step 4: OWNER — create the encrypted Secret**

Ask the owner to run this from the repository root, with their real values, **and to encrypt before doing anything else** (the plaintext must never be committed; CI also refuses an unencrypted `*.sops.yaml`):

```bash
cat > k8s/80-secrets.sops.yaml <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: fitnessai-secrets
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "<your Anthropic API key>"
  OWNER_EMAIL: "<the email you sign in to Cloudflare Access with>"
EOF
sops --encrypt --in-place k8s/80-secrets.sops.yaml
grep -c 'ENC\[' k8s/80-secrets.sops.yaml
```

Expected: `2` (both values encrypted). The email stays out of the public repository this way too.

- [ ] **Step 5: Render the manifests**

```bash
kubectl kustomize k8s > /tmp/fitnessai-rendered.yaml && grep -c '^kind:' /tmp/fitnessai-rendered.yaml
```

Expected: `9` (Namespace, PersistentVolumeClaim, Deployment, Service, two Ingresses, two Middlewares, Secret), and every resource except the Namespace has `namespace: fitnessai`.

- [ ] **Step 6: Commit**

```bash
git add .sops.yaml k8s
git commit -m "deploy: Kubernetes manifests and the SOPS-encrypted Secret"
```

---

### Task 25: CI — verify every change, build arm64, pin the tag

**Files:**
- Create: `.github/workflows/verify.yaml`, `.github/workflows/ci.yaml`

**Interfaces:**
- `verify.yaml` runs on every branch push and pull request and is reused by `ci.yaml`: jobs `checks` (type-check, lint, test, build), `manifests` (render + assertions), `secrets` (no keys in web code; every `*.sops.yaml` encrypted), `image` (build, boot, probe).
- `ci.yaml` runs on pushes to `main`: verify → build and push `ghcr.io/yanbin-pan/fitnessai:{sha,latest}` for `linux/arm64` → assert arm64 → commit the pinned tag to `k8s/kustomization.yaml`.

- [ ] **Step 1: `verify.yaml`**

`.github/workflows/verify.yaml`:

```yaml
# Fast feedback on every branch and pull request. Also exposed as workflow_call
# so the deploy pipeline reuses these exact jobs: nothing reaches GHCR that has
# not passed here.
name: Verify

on:
  push:
    branches-ignore: [main]
  pull_request:
  workflow_dispatch:
  workflow_call:

jobs:
  checks:
    name: Type-check, lint, test, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build

  manifests:
    name: Kubernetes manifests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ubuntu-latest usually ships kustomize; install it only when missing.
      - name: Ensure kustomize is available
        run: |
          set -euo pipefail
          if ! command -v kustomize >/dev/null 2>&1; then
            curl -sSfL --retry 3 \
              https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh \
              | bash -s -- 5.4.3 /usr/local/bin
          fi
          kustomize version
      # A manifest that does not build fails silently in the cluster (Flux keeps
      # serving the old version); here it fails the pull request instead.
      - name: kustomize build
        run: kustomize build k8s > /tmp/rendered.yaml
      - name: Assert the render is sane
        run: |
          set -euo pipefail
          r=/tmp/rendered.yaml
          fail() { echo "::error::$1"; exit 1; }
          grep -q 'router.middlewares: fitnessai-rate-limit@kubernetescrd' "$r" || fail "The main ingress lost its rate limiter."
          grep -q 'router.middlewares: fitnessai-coach-rate-limit@kubernetescrd' "$r" || fail "The coach ingress lost its rate limiter."
          [ "$(grep -c 'requestHeaderName: Cf-Connecting-Ip' "$r")" = "2" ] || fail "Both rate limiters must key on Cf-Connecting-Ip."
          grep -A1 'name: ACCESS_AUD' "$r" | grep -qE 'value: "?[0-9a-f]{64}"?$' || fail "ACCESS_AUD must be the 64-hex audience tag from Terraform."
          grep -A1 'name: ACCESS_TEAM_DOMAIN' "$r" | grep -q 'cloudflareaccess.com' || fail "ACCESS_TEAM_DOMAIN is not set."
          grep -A1 'name: NODE_ENV' "$r" | grep -q 'value: production' || fail "NODE_ENV must be production."
          grep -q 'key: OWNER_EMAIL' "$r" || fail "OWNER_EMAIL must come from the Secret."
          grep -qE '^  replicas: 1$' "$r" || fail "Exactly one replica: SQLite on NFS."
          grep -q 'type: Recreate' "$r" || fail "The Deployment must use strategy: Recreate."
          grep -q 'startupProbe:' "$r" || fail "The startup probe covers the database lock wait."
          grep -q 'ReadWriteOnce' "$r" || fail "The PVC must be ReadWriteOnce."
          grep -q 'storageClassName: ssd' "$r" || fail "The PVC must use the backed-up ssd class."
          grep -q 'memory: 384Mi' "$r" || fail "The memory limit is missing."
          echo "Manifests render correctly."

  secrets:
    name: No plaintext secrets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: The web app holds no Anthropic credential
        run: |
          if grep -rniE 'ANTHROPIC_API_KEY|x-api-key|sk-ant-' web/src web/index.html web/vite.config.ts; then
            echo "::error::Anthropic credentials must never appear in web code."
            exit 1
          fi
          echo "Web code is clean."
      # A readable *.sops.yaml means a secret was committed in the clear.
      - name: Every .sops.yaml is encrypted
        run: |
          set -euo pipefail
          found=0
          while IFS= read -r f; do
            found=1
            grep -q 'ENC\[' "$f" || { echo "::error file=$f::Not encrypted. Run: sops --encrypt --in-place $f"; exit 1; }
            grep -q '^sops:' "$f" || { echo "::error file=$f::No sops metadata; this file was not encrypted by sops."; exit 1; }
            if grep -qE 'sk-ant-' "$f"; then echo "::error file=$f::A plaintext key is visible."; exit 1; fi
            echo "$f is encrypted."
          # The repository's .sops.yaml is the sops *config*, never encrypted.
          done < <(find . -path ./node_modules -prune -o \( -name '*.sops.yaml' -o -name '*.sops.yml' \) ! -name '.sops.yaml' ! -name '.sops.yml' -print)
          [ "$found" = "1" ] || echo "No .sops.yaml files to check."

  # The tests run from the source tree, so a file missing from the image would
  # pass them all and then crash-loop in the cluster. Booting the image catches it.
  image:
    name: Image boots
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build the image (runner architecture)
        run: docker build -t fitnessai:ci .
      - name: Boot it and probe it
        run: |
          set -euo pipefail
          docker run -d --name app -p 8080:8080 --tmpfs /data:uid=1000,gid=1000 \
            -e ACCESS_TEAM_DOMAIN=ci.example.cloudflareaccess.com \
            -e ACCESS_AUD=ci-smoke-test-not-a-real-audience \
            -e OWNER_EMAIL=ci@example.com \
            fitnessai:ci
          fail() { echo "::error::$1"; docker logs app 2>&1 | tail -40; exit 1; }
          ready=0
          for i in $(seq 30); do
            [ "$(docker inspect -f '{{.State.Running}}' app)" = "true" ] || fail "The container exited instead of serving."
            if curl -fsS http://127.0.0.1:8080/api/health > /tmp/health.json 2>/dev/null; then ready=1; break; fi
            sleep 1
          done
          [ "$ready" = "1" ] || fail "/api/health never answered."
          grep -q '"ok":true' /tmp/health.json || fail "/api/health did not report ok."
          curl -fsS http://127.0.0.1:8080/day/today | grep -q 'id="root"' || fail "The PWA was not served."
          [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/profile)" = "401" ] || fail "/api/profile must require Access."
          echo "The image boots, serves the PWA and refuses unauthenticated API calls."
      - name: Tear down
        if: always()
        run: docker rm -f app 2>/dev/null || true
```

- [ ] **Step 2: `ci.yaml`**

`.github/workflows/ci.yaml`:

```yaml
# Merge to main → verify → build arm64 → pin the new tag → Flux deploys.
# The deploy step is a git commit, not a kubectl apply: Flux pulls, so no
# cluster credentials exist in GitHub, and a rollback is `git revert`.
name: Build and deploy

on:
  push:
    branches: [main]
    # The deploy job writes k8s/kustomization.yaml; ignoring it stops a build loop.
    paths-ignore:
      - "k8s/kustomization.yaml"
      - "**/*.md"
  workflow_dispatch:

# One deploy at a time: two concurrent runs would race on the push-back.
concurrency:
  group: deploy-main
  cancel-in-progress: false

jobs:
  verify:
    name: Verify
    uses: ./.github/workflows/verify.yaml

  build:
    name: Build image (linux/arm64)
    needs: verify
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
        with:
          platforms: arm64
      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/arm64
          push: true
          # Attestations would add an unknown/unknown manifest entry; noise for one platform.
          provenance: false
          tags: |
            ghcr.io/yanbin-pan/fitnessai:latest
            ghcr.io/yanbin-pan/fitnessai:${{ github.sha }}
          labels: org.opencontainers.image.source=https://github.com/yanbin-pan/fitnessAI
          cache-from: type=gha
          cache-to: type=gha,mode=max
      # An amd64 image crash-loops on the Pis with `exec format error`, which reads
      # like an application bug. Check what was actually pushed.
      - name: Verify the pushed image is arm64
        run: |
          set -euo pipefail
          arch=$(docker buildx imagetools inspect "ghcr.io/yanbin-pan/fitnessai:${{ github.sha }}" --format '{{.Image.Architecture}}')
          echo "Pushed architecture: ${arch:-<none>}"
          [ "$arch" = "arm64" ] || { echo "::error::Expected arm64, got '${arch:-<none>}'."; exit 1; }

  deploy:
    name: Pin the image for Flux
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - name: Pin the image to this commit
        run: |
          set -euo pipefail
          sed -i -E "s|^([[:space:]]*newTag:).*|\1 ${GITHUB_SHA}|" k8s/kustomization.yaml
          # Guard the sed: a silent no-match would leave the old image while the run went green.
          [ "$(grep -c "newTag: ${GITHUB_SHA}$" k8s/kustomization.yaml)" = "1" ] || {
            echo "::error::newTag was not pinned."; grep -n 'newTag:' k8s/kustomization.yaml; exit 1; }
      - name: Commit and push
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add k8s/kustomization.yaml
          if git diff --cached --quiet; then echo "Already pinned to this commit."; exit 0; fi
          git commit -m "Deploy ${GITHUB_SHA:0:7}" -m "Image tag pinned by CI. Flux reconciles this within a minute. Roll back by reverting this commit."
          # Another merge may have landed while the image was building.
          git pull --rebase --autostash origin main
          git push origin HEAD:main
```

- [ ] **Step 3: Check the workflow files parse**

Run: `npx --yes yaml-lint .github/workflows/verify.yaml .github/workflows/ci.yaml` (or `actionlint` if it is installed)
Expected: no errors. The real test is the first push in Task 26.

- [ ] **Step 4: Commit**

```bash
git add .github
git commit -m "ci: verify every change; build arm64 and pin the tag on main"
```

---

### Task 26: Publish and deploy

Every step that pushes, merges or changes GitHub settings needs the owner's explicit go-ahead first.

- [ ] **Step 1: Run every check locally once more**

Run: `npm ci && npm run typecheck && npm run lint && npm test && npm run build && kubectl kustomize k8s > /dev/null`
Expected: all green.

- [ ] **Step 2: Push (after the owner approves)**

`main` on GitHub is empty. Give it the design documents first, then propose the milestone as a pull request:

```bash
git push origin docs/fitnessai-design:main
git push -u origin m1-foundation
gh pr create --repo yanbin-pan/fitnessAI --base main --head m1-foundation \
  --title "Milestone 1: foundation and logging" \
  --body "Implements milestone 1 of docs/superpowers/specs/2026-10-03-fitnessai-design.md following docs/superpowers/plans/2026-10-03-fitnessai-milestone-1.md."
```

The first push contains only Markdown, which `ci.yaml` ignores. Expected on the pull request: the four Verify jobs (`checks`, `manifests`, `secrets`, `image`) pass. Fix anything red on the branch before going on.

- [ ] **Step 3: Merge, then confirm the deploy commit (owner merges)**

After the owner merges, the `Build and deploy` workflow runs on `main`. When it has finished, confirm:

```bash
git fetch origin && git log origin/main -1 --format='%s'
```

Expected: `Deploy <7 characters of the merge commit>` — CI pinned the image tag.

- [ ] **Step 4: Make the image pullable (OWNER, if needed)**

```bash
gh api /users/yanbin-pan/packages/container/fitnessai --jq .visibility
```

If it prints `private`, ask the owner to open GitHub → Packages → `fitnessai` → Package settings → Change visibility → **Public** (the cluster has no pull credentials, as with tea-cabinet). Re-run the command; expected `public`.

- [ ] **Step 5: Deploy through home-cluster (owner merges)**

In the home-cluster clone from Task 23:

```bash
git push -u origin fitnessai
gh pr create --repo yanbin-pan/home-cluster --base main --head fitnessai \
  --title "Add fitnessAI" --body "Access application for fitness.minipi.net (already applied) and the Flux GitRepository/Kustomization for yanbin-pan/fitnessAI."
```

After the owner merges:

```bash
flux reconcile source git flux-system && flux reconcile kustomization flux-system
flux get kustomizations fitnessai
kubectl -n fitnessai get pods
kubectl -n fitnessai logs deploy/fitnessai | head -20
```

Expected: the `fitnessai` Kustomization is `Ready True`; one pod `1/1 Running`; the logs show `Server listening at http://0.0.0.0:8080` and no warning that the coach is off.

- [ ] **Step 6: Check the edge and the in-cluster guard**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://fitness.minipi.net/
kubectl -n fitnessai run probe --rm -i --restart=Never --image=curlimages/curl -- \
  curl -sS -o /dev/null -w '%{http_code}\n' http://fitnessai:8080/api/profile
kubectl -n fitnessai run probe2 --rm -i --restart=Never --image=curlimages/curl -- \
  curl -sS http://fitnessai:8080/api/health
```

Expected: `302` (Cloudflare Access sends you to sign in), `401` (past the edge, the API still refuses unsigned requests), `{"ok":true}`.

Troubleshooting: `ImagePullBackOff` → Step 4; `CrashLoopBackOff` with `EACCES` on `/data` → the NFS directory is not writable by uid 1000 (check `ls -ld` of the PVC's directory under `/mnt/ssd/nfs/k8s` on rpi-01); every API call `401` after signing in → `ACCESS_AUD` does not match `terraform output -raw fitness_aud`.

---

### Task 27: On the iPhone, monitoring, and the README

**Files:**
- Create: `README.md`

- [ ] **Step 1: OWNER — the iPhone checklist**

Ask the owner to work through this on their iPhone and report each result:

1. Open `https://fitness.minipi.net` in Safari and sign in with the one-time PIN.
2. Share → **Add to Home Screen**, then open fitnessAI from the home screen (sign in again inside the app if asked).
3. Settings: fill in the profile and Save; the override fields show the calculated values.
4. Today: send "2 scrambled eggs and a coffee with milk" — try the keyboard's microphone for this one. Expected: a reply and an entry card with assumption notes; the calorie total and bars move.
5. Send "actually it was 3 eggs". Expected: the same card updates and says "edited".
6. Tap a card: change a number and Save; then delete it.
7. ‹ to yesterday, "+ Add manually" an item there, › back to today.
8. **The Access re-login test (spec §16):** in the Cloudflare Zero Trust dashboard, open Access → Applications → fitnessAI and use **Revoke existing tokens**. Then reopen the installed app and pull down to reload or send a message. Expected: the yellow "Signed out — Tap to sign in" banner; tapping it shows the Access login inside the app and returns to fitnessAI with your data. Record exactly what happened, including whether the login page opened inside the app or in a separate Safari sheet, and whether the app worked afterwards.

If item 8 fails, record it under "Known issues" in the README: milestone 2's plan then adds the service-token pairing fallback from spec §16.

- [ ] **Step 2: Check that Prometheus scrapes the pod**

```bash
svc=$(kubectl -n monitoring get svc -o name | grep -E 'prometheus.*server' | head -1); echo "$svc"
kubectl -n monitoring port-forward "$svc" 9090:80
```

(The plain Prometheus chart's server Service listens on port 80; if `kubectl -n monitoring get "$svc"` shows another port, use that.) Open `http://localhost:9090/targets` and search for `fitnessai`. Expected: one target `UP` at `<pod-ip>:9464/metrics`. If the cluster's Prometheus has no annotation-based pod job, record it under "Known issues" as a home-cluster follow-up (spec §16).

- [ ] **Step 3: Write the README**

`README.md` (fill the two "Known issues" bullets with what Steps 1 and 2 found; remove a bullet if that check passed):

````markdown
# fitnessAI

A personal food and training logbook with an AI coach, installable on an iPhone
and running on a home Raspberry Pi cluster.

Tell the coach what you ate or did ("2 scrambled eggs and a coffee") and it logs
each item with calories, macros, saturated fat, sugars, salt, fluids, alcohol and
food groups; workouts get active calories and muscles. Daily targets come from
your profile (Mifflin-St Jeor) and grow with part of your exercise calories.

Design: [`docs/superpowers/specs/2026-10-03-fitnessai-design.md`](docs/superpowers/specs/2026-10-03-fitnessai-design.md)
· Milestone 1 plan: [`docs/superpowers/plans/2026-10-03-fitnessai-milestone-1.md`](docs/superpowers/plans/2026-10-03-fitnessai-milestone-1.md)

## How it fits together

```
shared/   types and validation used by both sides
server/   Fastify API + SQLite (Drizzle), the Claude coach; Node 24 runs the TypeScript directly
web/      React PWA (Vite, Tailwind, TanStack Query)
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

Export `ANTHROPIC_API_KEY` before `npm run dev:server` to switch the coach on;
without it, manual logging still works.

```bash
npm test           # every workspace
npm run typecheck
npm run lint
npm run db:generate  # after changing server/src/db/schema.ts; commit the new migration
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` | — (required in production) | Cloudflare Access verification; only `OWNER_EMAIL` gets in |
| `ANTHROPIC_API_KEY` | unset | Turns the coach on |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | `claude-opus-5-5` / `medium` | `claude-sonnet-5-5` roughly halves the cost |
| `DATA_DIR` | `./.data` | Database and snapshots |
| `PORT` / `METRICS_PORT` | `8080` / `9464` | App and Prometheus ports |
| `COACH_BUDGET_MS` | `90000` | Time one coach message may take |
| `SNAPSHOT_KEEP` | `7` | Nightly snapshots kept |
| `DEV_AUTH_EMAIL` | unset | Development only (`NODE_ENV=development`): skips Access |

## Deploy

Merging to `main` runs `.github/workflows/ci.yaml`: verify, build a `linux/arm64`
image to `ghcr.io/yanbin-pan/fitnessai`, and commit the pinned tag to
`k8s/kustomization.yaml`. Flux (home-cluster `clusters/home/fitnessai.yaml`)
applies `k8s/` within a minute. Roll back by reverting the `Deploy …` commit.

Secrets live in `k8s/80-secrets.sops.yaml`, encrypted to the cluster's age key.
Edit with `sops k8s/80-secrets.sops.yaml`.

## Backups and restore

At 03:00 (profile timezone) the app writes `/data/snapshots/fitness-YYYY-MM-DD.db`
(keeps 7), and one more before every startup's migrations. The cluster's restic
job copies `/data` to R2 at 03:30.

To restore:

```bash
kubectl -n fitnessai scale deploy/fitnessai --replicas=0
# on rpi-01, in the PVC's directory under /mnt/ssd/nfs/k8s:
cp snapshots/fitness-YYYY-MM-DD.db fitness.db
kubectl -n fitnessai scale deploy/fitnessai --replicas=1
```

## On the iPhone

Open `https://fitness.minipi.net` in Safari, sign in, then Share → Add to Home
Screen. Voice input is the keyboard's microphone. If the app shows "Signed out",
tap the banner to sign in again; the Access session lasts 30 days.

## Known issues

- iPhone Access re-login test (milestone 1): <result from Task 27 Step 1, item 8>
- Prometheus scraping: <result from Task 27 Step 2>
````

- [ ] **Step 4: Commit and publish the README (after the owner approves)**

```bash
git switch main && git pull
git switch -c m1-readme
git add README.md
git commit -m "docs: README with development, deployment and restore notes"
git push -u origin m1-readme
gh pr create --repo yanbin-pan/fitnessAI --base main --head m1-readme --title "README for milestone 1" \
  --body "Development, deployment and restore notes, plus the iPhone and monitoring results from milestone 1."
```

Milestone 1 is done when the owner has merged this and the iPhone checklist passes (or its failures are recorded with their follow-ups).

