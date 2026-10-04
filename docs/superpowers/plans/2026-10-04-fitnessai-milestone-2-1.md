# fitnessAI Milestone 2.1 — Instant Replies, Activities and the Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Messages appear in the feed the moment they are sent and the coach's progress streams back as short live steps; an activities card under the nutrients; a calendar that drops down from the day bar with past days tinted by calories; 33 activities with matte badges; and the zabaione-ball home-screen icon — deployed like milestone 2.

**Architecture:** `POST /api/messages` and Retry answer a request that asks for `text/event-stream` with a stream of `stored`, `step` and `result` events, written by the existing route as the coach loop reports each model call and tool; everything refused before storing, and every finished repeat, stays JSON. The web app inserts the message optimistically, reads the stream with `fetch`, holds each step on screen for at least 1.5 s, and falls back to the existing 3-second poll when a stream drops. A new `GET /api/days?from=&to=` feeds the calendar; the calorie rule is one shared function. Activities grow to 33 in the shared vocabulary (a text column, so only a data migration re-files old `other` rows), with soft colours drawn as matte badges.

**Tech Stack:** Node 24 (TypeScript run directly), Fastify 5, Drizzle ORM 0.45 + better-sqlite3 13, Zod 4, Vitest 5; React 19, Vite 8, Tailwind 4, TanStack Query 5, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-fitnessai-design.md` (revision 4) — §3 D20–D22, §5.1 activities and the re-filing patterns, §6.1 activity rules, §6.3 live steps, §11.1 the day bar, the calendar, the activities card, instant sending and the picker, §11.4 badges, calendar tints and the home-screen icon, §12 API, §15 milestone 2.1 tests and live checks, §17 milestone 2.1.

## Global Constraints

- Node 24 runs the TypeScript directly: relative imports end in `.ts`/`.tsx`; types come in through `import type`; no enums, namespaces, parameter properties or other non-erasable syntax.
- Workspaces `shared/`, `server/`, `web/`. Per workspace: `npm test --workspace server` (or `shared`, `web`); whole repo: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- **No new runtime or dev dependencies** in any `package.json`. Icons are copied from `@material-symbols/svg-400@0.47.6` (Apache-2.0) by Task 1's generator; the package is never installed.
- Data changes go through drizzle-kit: a data-only migration is made with `npm run db:generate --workspace server -- --custom --name=<name>` and its SQL written into the generated file. Migrations run with foreign keys off, so a migration must never rely on a cascade.
- Activities: exactly the 33 keys of spec §5.1, in its order, with its names, short names, icons and light/dark colours (Task 1 writes them as code). `other` is the default.
- Live steps (spec §6.3): the client asks with `Accept: text/event-stream`; the response is `200`, `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`; events `stored` (`{ day }`), `step` (`{ text }`), `result` (the `MessageResult`), each written as `event: <name>\ndata: <json>\n\n`; a `: keep-alive\n\n` comment every 15000 ms. Refusals before storing and finished repeats stay JSON. Step texts are exactly spec §6.3's. The phone shows each step for at least 1500 ms.
- Calendar (spec §11.1, §12): `GET /api/days?from=&to=` → `{ goal, days: [{ date, kcal, target_kcal }] }`, at most 42 days, `400 { error: "bad_range" }` otherwise. `calorieStatus` compares `Math.round(eaten)` with the target rounded to 10: lose or maintain — `within` at or under, `near` up to 10 % over, `off` beyond; gain — mirrored. Tints, already mixed into the base: within `#B7D1C8` / `#3D544C`, near `#DCD1BA` / `#575042`, off `#DAC2C0` / `#584645` (light / dark).
- Design tokens are milestone 2's (spec §11.4): base `#E4E9F0` / `#262A31`; highlight `#FFFFFF` / `#31363F`; dark shadow `#BAC4D2` / `#17191E`; text `#28323F` / `#E8ECF1`; secondary `#55637A` / `#9AA5B5`; accent `#087A54` / `#34D399`; accent text `#067052` / `#34D399`; danger `#A8321F` / `#F2876F`. Utilities `raised`, `raised-sm`, `pressed`, `tap`. No blur; transitions off under `prefers-reduced-motion`; touch targets at least 44 px.
- Copy: sentence case; contractions; no "please", "successfully" or "!" in system text; the UI speaks as the product.
- Privacy (public repository): never log message text, photos, health values or step texts; tests generate their own images; nothing real is committed.
- The coach keeps exactly one strict tool (`log_items`); its enum grows to 33 in Task 1, and Task 11 checks the grammar against the live API.
- Milestone 1 and 2 behaviour stays: idempotent message ids, staged coach writes committed in one transaction, Retry, Undo, signed-out detection, back-dated linked entries, the append-only daily thread, 48-hour retention, the photo limits.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Task | Responsibility |
|---|---|---|
| `shared/src/vocab.ts` | 1 | the 33 `ACTIVITIES` |
| `shared/src/calendar.ts` | 4 | `calorieStatus`, `CalorieStatus`, `NEAR_SHARE` |
| `shared/src/api.ts` | 4 | `DaySummary`, `DaySummaries` |
| `server/src/coach/tools.ts`, `server/src/coach/prompt.ts` | 1 | the activity hints; street photography's MET |
| `server/drizzle/0002_refile_activities.sql` | 3 | re-files `other` exercises by name |
| `server/src/days/days.ts`, `server/src/routes/days.ts` | 4 | `daySummaries`, `GET /api/days?from=&to=` |
| `server/src/coach/loop.ts`, `server/src/coach/steps.ts`, `server/src/coach/process.ts` | 7 | `LoopStep`, `onStep`, `stepText` |
| `server/src/routes/stream.ts`, `server/src/routes/messages.ts`, `server/src/deps.ts` | 7 | `openEventStream`; streaming sends and retries |
| `web/src/icons/paths.ts` | 1 | regenerated: 44 icons |
| `web/src/components/SportBadge.tsx` | 1, 2, 6 | `SPORTS`, `FEATURED`, `FAMILIES`, the matte `SportBadge` |
| `web/src/components/EntryEditor.tsx` | 1, 2 | the activity picker: featured row, More grid |
| `web/src/format.ts`, `web/src/queries.ts`, `web/src/index.css` | 5, 9 | day-bar and calendar wording; `useDaySummaries`; tint tokens; the poll waits for live sends |
| `web/src/components/Calendar.tsx`, `web/src/components/DayNav.tsx` | 5 | the month drop-down; the new day bar |
| `web/src/components/ActivitiesCard.tsx`, `web/src/pages/TodayPage.tsx` | 6, 9 | the activities card; streamed Retry |
| `web/src/api.ts`, `web/src/coach/stream.ts`, `web/src/coach/live.ts` | 8 | `responseError`; `streamCoach`; the live-step store |
| `web/src/coach/pending.ts`, `web/src/components/Composer.tsx`, `web/src/components/Feed.tsx` | 9 | the optimistic message; instant send; the coach's status row |
| `web/public/logo.svg`, `web/public/*.png`, `web/public/favicon.ico`, `README.md` | 10 | the zabaione-ball icon |

---

### Task 1: 33 activities, matte badges, and the owner's four first

**Files:**
- Modify: `shared/src/vocab.ts`
- Create: `shared/test/vocab.test.ts`
- Modify: `server/src/coach/tools.ts:33-35`, `server/src/coach/prompt.ts:31`
- Modify: `server/test/coach-tools.test.ts:59-64`, `server/test/coach-context.test.ts`
- Modify (generated): `web/src/icons/paths.ts`; `web/src/icons/Icon.test.tsx`
- Modify: `web/src/components/SportBadge.tsx`, `web/src/components/SportBadge.test.tsx`
- Modify: `web/src/components/EntryEditor.tsx:86-121`, `web/src/components/EntryEditor.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ACTIVITIES` (33, spec order) and `Activity`; `SPORTS: Record<Activity, Sport>` with `Sport = { label: string; short: string; icon: IconName; light: string; dark: string }`; `FEATURED: readonly Activity[]` (`tennis`, `gym`, `wakeboarding`, `kitesurfing`); `SportBadge({ activity, size = 36, labelled = true })`; icon names `padel` … `interests` and `calendar_month` in `ICON_PATHS` (44 in all).

- [ ] **Step 1: Write the failing tests**

Create `shared/test/vocab.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACTIVITIES } from "../src/vocab.ts";

describe("ACTIVITIES", () => {
  it("lists 33 activities once each: the owner's four first, other last", () => {
    expect(ACTIVITIES).toHaveLength(33);
    expect(new Set(ACTIVITIES).size).toBe(33);
    expect(ACTIVITIES.slice(0, 4)).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
    expect(ACTIVITIES[ACTIVITIES.length - 1]).toBe("other");
    for (const activity of ACTIVITIES) expect(activity).toMatch(/^[a-z_]+$/);
  });
});
```

In `server/test/coach-tools.test.ts`, replace the test `"ask for each exercise's activity from the fixed list"` with (add `ACTIVITIES` to the imports from `../src/shared.ts`):

```ts
  it("ask for each exercise's activity from the 33, with hints for the ones people describe in other words", () => {
    const schema = COACH_TOOLS[0].input_schema as {
      properties: { exercises: { items: { properties: Record<string, { enum?: string[]; description?: string }>; required: string[] } } };
    };
    const exercise = schema.properties.exercises.items;
    expect(exercise.properties.activity.enum).toEqual([...ACTIVITIES]);
    expect(exercise.properties.activity.enum).toHaveLength(33);
    expect(exercise.required).toContain("activity");
    const hints = exercise.properties.activity.description ?? "";
    for (const hint of ["gym: any weight or machine training", "photography: a photo walk or shoot", "yoga: also pilates", "kayaking: also canoeing", "boxing: also kickboxing", "martial_arts:", "other: anything without a fitting activity"]) {
      expect(hints).toContain(hint);
    }
  });
```

In `server/test/coach-context.test.ts`, add inside the describe that tests `COACH_INSTRUCTIONS`:

```ts
  it("files every exercise under one of the activities, and counts a photo walk's walking time", () => {
    expect(COACH_INSTRUCTIONS).toContain("Set activity to the sport from the allowed list");
    expect(COACH_INSTRUCTIONS).toContain("is activity photography");
    expect(COACH_INSTRUCTIONS).toContain("about MET 3.5 with a light camera");
    expect(COACH_INSTRUCTIONS).toContain("about 2.5 for time spent standing and shooting");
  });
```

In `web/src/icons/Icon.test.tsx`, change `toHaveLength(16)` to `toHaveLength(44)`.

Replace `web/src/components/SportBadge.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "../icons/paths.ts";
import { ACTIVITIES } from "../shared.ts";
import { FEATURED, SPORTS, SportBadge } from "./SportBadge.tsx";

const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("SportBadge", () => {
  it("is named after its sport, unless its caller names it", () => {
    const { rerender } = render(<SportBadge activity="wakeboarding" />);
    expect(screen.getByRole("img", { name: "Wakeboarding" })).toBeInTheDocument();
    // The activity picker puts the sport's name on the button around the badge, so the badge itself stays quiet.
    rerender(<SportBadge activity="wakeboarding" labelled={false} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws the pictogram in its soft colour for each theme on a matte disc, with no coloured fill", () => {
    const { container } = render(<SportBadge activity="cycling" />);
    const disc = container.firstElementChild as HTMLElement;
    expect(disc).toHaveClass("raised-sm", "text-(color:--sport-light)", "dark:text-(color:--sport-dark)");
    expect(disc.style.getPropertyValue("--sport-light")).toBe("#9A7832");
    expect(disc.style.getPropertyValue("--sport-dark")).toBe("#E0C489");
    expect(disc.style.backgroundColor).toBe("");
  });

  it("has a name, a short name, its own pictogram and both colours for every activity", () => {
    for (const activity of ACTIVITIES) {
      const sport = SPORTS[activity];
      expect(sport.label, activity).not.toBe("");
      expect(sport.short, activity).not.toBe("");
      expect(ICON_PATHS[sport.icon], activity).toBeDefined();
      expect(sport.light, activity).toMatch(/^#[0-9A-F]{6}$/);
      expect(sport.dark, activity).toMatch(/^#[0-9A-F]{6}$/);
    }
    const icons = ACTIVITIES.map((activity) => SPORTS[activity].icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("keeps every pictogram at 3:1 or more against the base colour in both themes", () => {
    for (const activity of ACTIVITIES) {
      expect(contrast(SPORTS[activity].light, "#E4E9F0"), activity).toBeGreaterThanOrEqual(3);
      expect(contrast(SPORTS[activity].dark, "#262A31"), activity).toBeGreaterThanOrEqual(3);
    }
  });

  it("features the owner's four sports", () => {
    expect(FEATURED).toEqual(["tennis", "gym", "wakeboarding", "kitesurfing"]);
  });
});
```

In `web/src/components/EntryEditor.test.tsx`, add inside `describe("EntryEditor")`:

```tsx
  it("offers the owner's four sports, and the exercise's own activity when it is another", () => {
    const ride = entry({ foods: [], exercises: [exerciseItem({ name: "Bike ride", category: "cardio", activity: "cycling" })] });
    mockFetch(() => jsonResponse({ entry: ride, day: dayView() }));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={ride} onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Tennis", "Gym", "Wakeboarding", "Kitesurfing", "Cycling"]);
    expect(within(group).getByRole("radio", { name: "Cycling" })).toBeChecked();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace shared && npm test --workspace server -- coach-tools coach-context && npm test --workspace web -- SportBadge Icon EntryEditor`
Expected: FAIL — `ACTIVITIES` has 5 entries; the enum has 5 values and no hints; the prompt lacks the new lines; `ICON_PATHS` has 16 entries (44 expected); `SPORTS.cycling` is undefined and `FEATURED` is not exported.

- [ ] **Step 3: The vocabulary, the tool's hints and the prompt**

In `shared/src/vocab.ts`, replace the `ACTIVITIES` block with:

```ts
/**
 * The sport an exercise was (spec §5.1). `category` drives muscle volume and habits; this drives the badge.
 * The owner's four come first and `other` last; the rest follow the More grid's families.
 */
export const ACTIVITIES = [
  "tennis", "gym", "wakeboarding", "kitesurfing",
  "padel", "badminton",
  "running", "walking", "hiking", "photography", "cycling", "skateboarding",
  "swimming", "surfing", "rowing", "kayaking", "sailing", "diving",
  "boxing", "martial_arts", "yoga", "climbing",
  "football", "basketball", "volleyball", "rugby", "cricket", "hockey",
  "skiing", "snowboarding", "skating",
  "golf", "other",
] as const;
export type Activity = (typeof ACTIVITIES)[number];
```

In `server/src/coach/tools.ts`, replace the `activity:` property of `ExerciseToolItem` with:

```ts
  activity: z
    .enum(ACTIVITIES)
    .describe(
      "The sport. gym: any weight or machine training, and classes such as HIIT or circuits; photography: a photo walk or shoot; yoga: also pilates and stretching; kayaking: also canoeing and stand-up paddleboarding; boxing: also kickboxing and boxing fitness; martial_arts: karate, judo, jiu-jitsu, taekwondo, MMA; other: anything without a fitting activity, such as squash, table tennis, dance or horse riding",
    ),
```

In `server/src/coach/prompt.ts`, replace the line that starts `- Set activity to the sport: tennis` with these two lines:

```ts
- Set activity to the sport from the allowed list: tennis (say singles or doubles in the assumption when it matters), gym for any weight or machine training and classes such as HIIT or circuits, and the others by what they are (a run is running, a bike ride cycling, pilates yoga, kickboxing boxing, a canoe or paddleboard kayaking); other only when nothing fits, such as squash, table tennis, dance or horse riding. For wakeboarding and kitesurfing the duration is the time actually riding on the water, not the whole session at the spot; say in the assumption what you counted.
- Street photography (a photo walk or shoot) is activity photography: count the walking time at about MET 3.5 with a light camera, 4.5 to 5 carrying a heavy bag or a tripod or on hills and stairs, and about 2.5 for time spent standing and shooting; say in the assumption which you used.
```

(These lines sit inside the `COACH_INSTRUCTIONS` template literal: no backticks or `${` in them.)

- [ ] **Step 4: Regenerate the icons**

Run from the repository root:

```bash
tmp=$(mktemp -d)
(cd "$tmp" && npm pack @material-symbols/svg-400@0.47.6 --silent >/dev/null && tar xzf material-symbols-svg-400-0.47.6.tgz)
node -e '
const fs = require("node:fs");
const names = ["sports_tennis", "fitness_center", "surfing", "kitesurfing", "directions_run", "sunny", "settings",
  "add_a_photo", "arrow_upward", "close", "chevron_left", "chevron_right", "restaurant", "sports", "photo_camera", "refresh",
  "padel", "badminton", "directions_walk", "hiking", "directions_bike", "skateboarding", "pool", "waves", "rowing",
  "kayaking", "sailing", "scuba_diving", "sports_mma", "sports_martial_arts", "self_improvement", "mountain_flag",
  "sports_soccer", "sports_basketball", "sports_volleyball", "sports_rugby", "sports_cricket", "sports_hockey",
  "downhill_skiing", "snowboarding", "ice_skating", "sports_golf", "interests", "calendar_month"];
const dir = `${process.argv[1]}/package/rounded`;
const lines = names.map((name) => {
  const svg = fs.readFileSync(`${dir}/${name}-fill.svg`, "utf8");
  if (!svg.includes(`viewBox="0 -960 960 960"`)) throw new Error(`${name}: unexpected viewBox`);
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length !== 1) throw new Error(`${name}: expected one path, found ${paths.length}`);
  return `  ${name}: "${paths[0]}",`;
});
fs.writeFileSync("web/src/icons/paths.ts", [
  "// Material Symbols Rounded, filled, weight 400 — from @material-symbols/svg-400@0.47.6.",
  "// Copyright Google LLC, licensed under the Apache License 2.0: see LICENSE beside this file.",
  "// Generated by the command in docs/superpowers/plans/2026-10-04-fitnessai-milestone-2-1.md, Task 1; do not edit by hand.",
  "// Every path is drawn in the viewBox 0 -960 960 960.",
  "export const ICON_PATHS = {",
  ...lines,
  "} as const;",
  "",
  "export type IconName = keyof typeof ICON_PATHS;",
  "",
].join("\n"));
' "$tmp"
cmp "$tmp/package/LICENSE" web/src/icons/LICENSE && rm -rf "$tmp"
```

Expected: `web/src/icons/paths.ts` with 44 entries; `cmp` prints nothing (the licence beside it is unchanged) and the temporary folder is removed.

- [ ] **Step 5: The matte badge and the featured picker**

Replace `web/src/components/SportBadge.tsx` with:

```tsx
import type { CSSProperties } from "react";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/paths.ts";
import type { Activity } from "../shared.ts";

export interface Sport {
  label: string;
  /** For tight rows, such as the editor's picker. */
  short: string;
  icon: IconName;
  /** The pictogram's colour on the light base and on the dark base (spec §5.1); both reach 3:1 or more. */
  light: string;
  dark: string;
}

/** Every activity's name, short name, pictogram and soft colours (spec §5.1). */
export const SPORTS: Record<Activity, Sport> = {
  tennis: { label: "Tennis", short: "Tennis", icon: "sports_tennis", light: "#6E8B3D", dark: "#B5CF8A" },
  gym: { label: "Gym", short: "Gym", icon: "fitness_center", light: "#B5654A", dark: "#E7A58E" },
  wakeboarding: { label: "Wakeboarding", short: "Wake", icon: "surfing", light: "#4F7BB0", dark: "#9DBBE0" },
  kitesurfing: { label: "Kitesurfing", short: "Kite", icon: "kitesurfing", light: "#3E8C86", dark: "#8FCFC9" },
  padel: { label: "Padel", short: "Padel", icon: "padel", light: "#5F8A4A", dark: "#A9CF95" },
  badminton: { label: "Badminton", short: "Badminton", icon: "badminton", light: "#4A8A6A", dark: "#96CDB0" },
  running: { label: "Running", short: "Run", icon: "directions_run", light: "#A86C38", dark: "#E5B88A" },
  walking: { label: "Walking", short: "Walk", icon: "directions_walk", light: "#A0704A", dark: "#D8B394" },
  hiking: { label: "Hiking", short: "Hike", icon: "hiking", light: "#7E6A4F", dark: "#C8B497" },
  photography: { label: "Photography", short: "Photo", icon: "photo_camera", light: "#7A6F66", dark: "#C2B8AF" },
  cycling: { label: "Cycling", short: "Bike", icon: "directions_bike", light: "#9A7832", dark: "#E0C489" },
  skateboarding: { label: "Skateboarding", short: "Skateboard", icon: "skateboarding", light: "#8F7F45", dark: "#D2C48E" },
  swimming: { label: "Swimming", short: "Swim", icon: "pool", light: "#4A84A8", dark: "#97C3DD" },
  surfing: { label: "Surfing", short: "Surf", icon: "waves", light: "#3A8599", dark: "#8CCAD9" },
  rowing: { label: "Rowing", short: "Row", icon: "rowing", light: "#5670A8", dark: "#A3B5DE" },
  kayaking: { label: "Kayak and SUP", short: "Kayak", icon: "kayaking", light: "#3E7F8F", dark: "#8EC2CE" },
  sailing: { label: "Sailing", short: "Sail", icon: "sailing", light: "#4C6A9A", dark: "#9FB3D6" },
  diving: { label: "Diving", short: "Dive", icon: "scuba_diving", light: "#45608A", dark: "#98ABCC" },
  boxing: { label: "Boxing", short: "Boxing", icon: "sports_mma", light: "#B4554F", dark: "#E59C97" },
  martial_arts: { label: "Martial arts", short: "Martial", icon: "sports_martial_arts", light: "#9A5A55", dark: "#D8A39E" },
  yoga: { label: "Yoga and pilates", short: "Yoga", icon: "self_improvement", light: "#8A6FB0", dark: "#C5B3E0" },
  climbing: { label: "Climbing", short: "Climb", icon: "mountain_flag", light: "#857A6E", dark: "#C7BDB2" },
  football: { label: "Football", short: "Football", icon: "sports_soccer", light: "#5F68A8", dark: "#AAB0DE" },
  basketball: { label: "Basketball", short: "Basketball", icon: "sports_basketball", light: "#7B67A8", dark: "#BBADDD" },
  volleyball: { label: "Volleyball", short: "Volleyball", icon: "sports_volleyball", light: "#6E62A0", dark: "#B3AAD8" },
  rugby: { label: "Rugby", short: "Rugby", icon: "sports_rugby", light: "#665E96", dark: "#ADA6D2" },
  cricket: { label: "Cricket", short: "Cricket", icon: "sports_cricket", light: "#5E5A8C", dark: "#A8A4CC" },
  hockey: { label: "Hockey", short: "Hockey", icon: "sports_hockey", light: "#565E92", dark: "#A3A9D0" },
  skiing: { label: "Skiing", short: "Ski", icon: "downhill_skiing", light: "#5A86A3", dark: "#A6C4D8" },
  snowboarding: { label: "Snowboarding", short: "Snowboard", icon: "snowboarding", light: "#557C99", dark: "#A2BCD0" },
  skating: { label: "Skating", short: "Skating", icon: "ice_skating", light: "#4E728F", dark: "#9DB6CB" },
  golf: { label: "Golf", short: "Golf", icon: "sports_golf", light: "#4F7F55", dark: "#9CC6A1" },
  other: { label: "Other", short: "Other", icon: "interests", light: "#6F7785", dark: "#B7BECA" },
};

/** The owner's main sports, offered first wherever an activity is picked (spec §5.1). */
export const FEATURED: readonly Activity[] = ["tennis", "gym", "wakeboarding", "kitesurfing"];

/**
 * The activity's pictogram in its soft colour on a matte disc, raised from the surface (spec §11.4).
 * Named after the sport unless `labelled` is false.
 */
export function SportBadge({ activity, size = 36, labelled = true }: { activity: Activity; size?: number; labelled?: boolean }) {
  const sport = SPORTS[activity];
  // Both themes' colours ride along as variables; the dark: variant picks the dark one.
  const style = { "--sport-light": sport.light, "--sport-dark": sport.dark, width: size, height: size } as CSSProperties;
  return (
    <span
      className="raised-sm inline-flex shrink-0 items-center justify-center rounded-full text-(color:--sport-light) dark:text-(color:--sport-dark)"
      style={style}
    >
      <Icon name={sport.icon} size={Math.round(size * 0.58)} label={labelled ? sport.label : undefined} />
    </span>
  );
}
```

In `web/src/components/EntryEditor.tsx`: import `FEATURED` with `SPORTS, SportBadge` from `./SportBadge.tsx`; replace the doc comment above `ActivityPicker` with

```tsx
/** The owner's four activities as a radio row of their badges, plus the exercise's own when it is another (spec §11.1); the full name is each choice's label. */
```

and inside it, before `return`, add

```tsx
  const shown = FEATURED.includes(value) ? FEATURED : [...FEATURED, value];
```

then change `{ACTIVITIES.map((activity) => {` to `{shown.map((activity) => {`. Remove `ACTIVITIES` from the `../shared.ts` import if nothing else in the file uses it.

- [ ] **Step 6: Run the tests to see them pass**

Run: `npm test --workspace shared && npm test --workspace server && npm test --workspace web && npm run typecheck && npm run lint`
Expected: PASS. The existing picker tests still pass: a new exercise (`other`) shows Tennis, Gym, Wakeboarding, Kitesurfing and Other — five radios — and the arrow keys move from Other to Kitesurfing.

- [ ] **Step 7: Commit**

```bash
git add shared/src/vocab.ts shared/test/vocab.test.ts server/src/coach/tools.ts server/src/coach/prompt.ts server/test/coach-tools.test.ts server/test/coach-context.test.ts web/src/icons/paths.ts web/src/icons/Icon.test.tsx web/src/components/SportBadge.tsx web/src/components/SportBadge.test.tsx web/src/components/EntryEditor.tsx web/src/components/EntryEditor.test.tsx
git commit -m "feat: 33 activities with matte badges; the coach files every exercise under one

The vocabulary, the strict tool's enum and the editor grow to spec §5.1's 33
activities, each with a soft colour per theme on a raised disc. The coach gets
hints for activities people describe in other words, and street photography's
walking MET. The editor offers the owner's four first.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The editor's More grid

**Files:**
- Modify: `web/src/components/SportBadge.tsx` (add `FAMILIES`), `web/src/components/SportBadge.test.tsx`
- Modify: `web/src/components/EntryEditor.tsx` (`ActivityPicker`), `web/src/components/EntryEditor.test.tsx`

**Interfaces:**
- Consumes: Task 1's `SPORTS`, `FEATURED`, `SportBadge`; `quietButton` from `./ui.tsx`.
- Produces: `FAMILIES: readonly { name: string; activities: readonly Activity[] }[]`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/components/SportBadge.test.tsx` (import `FAMILIES` too):

```tsx
  it("puts every activity in exactly one family, in the vocabulary's order", () => {
    expect(FAMILIES.flatMap((family) => family.activities)).toEqual([...ACTIVITIES]);
    expect(FAMILIES.map((family) => family.name)).toEqual([
      "Your sports", "Racket", "On foot and wheels", "Water", "Combat, body and mind", "Team", "Snow and ice", "Everything else",
    ]);
  });
```

Add to `web/src/components/EntryEditor.test.tsx`:

```tsx
  it("opens every activity by family under More, and a tap picks one and folds them away", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    await userEvent.type(screen.getByLabelText("Exercise"), "Boxing class");
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    const group = screen.getByRole("group", { name: "Activity for exercise 1" });
    expect(within(group).getAllByRole("radio")).toHaveLength(33);
    expect(within(group).getByText("Combat, body and mind")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("radio", { name: "Boxing" }));
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "false");
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Tennis", "Gym", "Wakeboarding", "Kitesurfing", "Boxing"]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).exercises[0].activity).toBe("boxing");
  });

  it("keeps the open grid for the keyboard: the arrow keys move through every activity", async () => {
    mockFetch(() => jsonResponse({ entry: entry(), day: dayView() }, 201));
    renderWithProviders(<EntryEditor date="2026-10-03" entry={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    screen.getByRole("radio", { name: "Other" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Golf" })).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Skating" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Fewer" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("radio")).toHaveLength(33);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace web -- SportBadge EntryEditor`
Expected: FAIL — `FAMILIES` is not exported; there is no More button.

- [ ] **Step 3: Implement**

Add to `web/src/components/SportBadge.tsx`, after `FEATURED`:

```tsx
/** Every activity by family, in the order the editor's More grid shows them (spec §11.1). */
export const FAMILIES: readonly { name: string; activities: readonly Activity[] }[] = [
  { name: "Your sports", activities: ["tennis", "gym", "wakeboarding", "kitesurfing"] },
  { name: "Racket", activities: ["padel", "badminton"] },
  { name: "On foot and wheels", activities: ["running", "walking", "hiking", "photography", "cycling", "skateboarding"] },
  { name: "Water", activities: ["swimming", "surfing", "rowing", "kayaking", "sailing", "diving"] },
  { name: "Combat, body and mind", activities: ["boxing", "martial_arts", "yoga", "climbing"] },
  { name: "Team", activities: ["football", "basketball", "volleyball", "rugby", "cricket", "hockey"] },
  { name: "Snow and ice", activities: ["skiing", "snowboarding", "skating"] },
  { name: "Everything else", activities: ["golf", "other"] },
];
```

In `web/src/components/EntryEditor.tsx`, import `FAMILIES` with the other `./SportBadge.tsx` names, `quietButton` from `./ui.tsx` if it is not imported yet, `useState` from `react`, and `MouseEvent` as a type from `react`; then replace the whole `ActivityPicker` (doc comment included) with:

```tsx
/**
 * An exercise's activity (spec §11.1): the owner's four and the exercise's own as a row of badges, and More,
 * which swaps the row for every activity by family. Either way it is one radio group: one keyboard stop.
 */
function ActivityPicker({ exercise, value, onChange }: { exercise: number; value: Activity; onChange: (value: Activity) => void }) {
  const name = useId();
  const [all, setAll] = useState(false);
  const shown = FEATURED.includes(value) ? FEATURED : [...FEATURED, value];
  // A tap picks and folds the grid away. The arrow keys also "click" a radio, with detail 0: those only
  // move the choice, so someone browsing the grid by keyboard keeps it open.
  const folds = (event: MouseEvent<HTMLInputElement>) => {
    if (event.detail > 0) setAll(false);
  };
  const choice = (activity: Activity) => {
    const chosen = activity === value;
    return (
      <label
        key={activity}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-2xl py-1.5 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${chosen ? "raised-sm font-semibold text-ink" : "text-muted"}`}
      >
        <input
          type="radio"
          name={name}
          value={activity}
          checked={chosen}
          onChange={() => onChange(activity)}
          onClick={folds}
          aria-label={SPORTS[activity].label}
          className="sr-only"
        />
        <SportBadge activity={activity} size={32} labelled={false} />
        {SPORTS[activity].short}
      </label>
    );
  };
  return (
    <fieldset className="mt-2">
      {/* Every exercise has a picker: the hidden words tell a screen reader which one this is. */}
      <legend className="text-xs">
        Activity <span className="sr-only">for exercise {exercise}</span>
      </legend>
      {all ? (
        <div className="mt-1 flex flex-col gap-2">
          {FAMILIES.map((family) => (
            <div key={family.name}>
              <p className="px-1 text-xs text-muted">{family.name}</p>
              <div className="mt-1 grid grid-cols-5 gap-1">{family.activities.map(choice)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-5 gap-1">{shown.map(choice)}</div>
      )}
      <button type="button" aria-expanded={all} onClick={() => setAll((open) => !open)} className={`${quietButton} mt-1 min-h-11 text-xs`}>
        {all ? "Fewer" : "More"}
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test --workspace web && npm run typecheck && npm run lint`
Expected: PASS, including every existing picker test.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SportBadge.tsx web/src/components/SportBadge.test.tsx web/src/components/EntryEditor.tsx web/src/components/EntryEditor.test.tsx
git commit -m "feat(web): the editor's More grid shows every activity by family

A tap picks one and folds the grid away; the arrow keys browse it without
folding (their synthetic click has detail 0). Still one radio group.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Re-file `other` exercises (migration 0002)

**Files:**
- Create (generated, then written): `server/drizzle/0002_refile_activities.sql`, plus drizzle-kit's `server/drizzle/meta/0002_snapshot.json` and the `_journal.json` entry
- Modify: `server/test/db.test.ts`

**Interfaces:**
- Consumes: Task 1's 33 activity keys.
- Produces: migration `0002_refile_activities` (data only; the schema is unchanged).

- [ ] **Step 1: Write the failing test**

Add to `server/test/db.test.ts`, inside `describe("openDatabase", …)`:

```ts
  it("re-files exercises still filed as other when their name clearly says what they were (milestone 2.1)", () => {
    const dir = tempDir();
    const file = path.join(dir, "fitness.db");
    const m2 = openDatabase({ file, snapshotDir: null, migrationsFolder: migrationsUpTo(2) });
    m2.sqlite.exec(
      "INSERT INTO entries (id, date, logged_at, source, message_id, edited, created_at, updated_at) VALUES ('e1', '2026-10-03', '2026-10-03T10:00:00.000Z', 'manual', NULL, 0, 'x', 'x');",
    );
    const insert = m2.sqlite.prepare(
      "INSERT INTO exercise_items (id, entry_id, position, name, category, activity, kcal, kcal_measured, assumption) VALUES (?, 'e1', ?, ?, ?, ?, 100, 0, '')",
    );
    const rows: [string, string, string, string, string][] = [
      ["x1", "Run", "cardio", "other", "running"],
      ["x2", "Trunk rotations", "mobility", "other", "other"],
      ["x3", "Inchworm walkouts", "mobility", "other", "other"],
      ["x4", "Kick-boxing class", "cardio", "other", "boxing"],
      ["x5", "Street photography walk", "cardio", "other", "photography"],
      ["x6", "Skipping rope", "cardio", "other", "other"],
      ["x7", "Spine stretch", "mobility", "other", "other"],
      ["x8", "Mountain bike ride", "cardio", "other", "cycling"],
      ["x9", "Jiu-jitsu", "sport", "other", "martial_arts"],
      ["x10", "Morning swim", "cardio", "other", "swimming"],
      ["x11", "Tennis singles", "sport", "tennis", "tennis"],
      ["x12", "Rowing machine", "cardio", "other", "rowing"],
      ["x13", "Bent-over rows", "strength", "gym", "gym"],
      ["x14", "Squash", "sport", "other", "other"],
      ["x15", "Pilates", "mobility", "other", "yoga"],
      ["x16", "Run club warm-up walk", "cardio", "other", "running"],
      ["x17", "Kickboxing", "cardio", "other", "boxing"],
      ["x18", "HIIT class", "cardio", "other", "gym"],
    ];
    rows.forEach(([id, name, category, activity], i) => insert.run(id, i, name, category, activity));
    m2.close();

    const now = openDatabase({ file, snapshotDir: null });
    try {
      const got = Object.fromEntries(
        (now.sqlite.prepare("SELECT id, activity FROM exercise_items").all() as { id: string; activity: string }[]).map((r) => [r.id, r.activity]),
      );
      expect(got).toEqual(Object.fromEntries(rows.map(([id, , , , expected]) => [id, expected])));
    } finally {
      now.close();
    }
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npm test --workspace server -- db.test`
Expected: FAIL — every row keeps its old activity (no migration 0002 yet).

- [ ] **Step 3: Generate the migration and write its SQL**

Run: `npm run db:generate --workspace server -- --custom --name=refile_activities`
Expected: drizzle-kit creates `server/drizzle/0002_refile_activities.sql` and adds `0002_refile_activities` to `server/drizzle/meta/_journal.json` (with a `0002_snapshot.json`). Then replace the generated file's contents with:

```sql
-- Milestone 2.1 (spec §5.1): exercises still filed as `other` move to the activity their name clearly
-- names. A pattern must start a word, so the name is lowercased, its hyphens and slashes become spaces,
-- and it gets a leading space ("Kick-boxing" reads " kick boxing"). The first match wins; the running,
-- walking, cycling, swimming and hiking patterns only re-file cardio or sport exercises; the rest stay `other`.
WITH `named` AS (
  SELECT `id`, `category`, ' ' || replace(replace(lower(`name`), '-', ' '), '/', ' ') AS `h`
  FROM `exercise_items`
  WHERE `activity` = 'other'
), `refiled` AS (
  SELECT `id`, CASE
    WHEN `h` LIKE '% photo%' THEN 'photography'
    WHEN `h` LIKE '% padel%' THEN 'padel'
    WHEN `h` LIKE '% badminton%' THEN 'badminton'
    WHEN `h` LIKE '% boxing%' OR `h` LIKE '% kickboxing%' THEN 'boxing'
    WHEN `h` LIKE '% karate%' OR `h` LIKE '% judo%' OR `h` LIKE '% jiu%' OR `h` LIKE '% taekwondo%' OR `h` LIKE '% martial%' THEN 'martial_arts'
    WHEN `h` LIKE '% yoga%' OR `h` LIKE '% pilates%' THEN 'yoga'
    WHEN `h` LIKE '% boulder%' OR `h` LIKE '% rock climb%' OR `h` LIKE '% climbing wall%' THEN 'climbing'
    WHEN `category` IN ('cardio', 'sport') AND (`h` LIKE '% hike%' OR `h` LIKE '% hiking%') THEN 'hiking'
    WHEN `category` IN ('cardio', 'sport') AND (`h` LIKE '% run%' OR `h` LIKE '% jog%') THEN 'running'
    WHEN `category` IN ('cardio', 'sport') AND `h` LIKE '% walk%' THEN 'walking'
    WHEN `category` IN ('cardio', 'sport') AND (`h` LIKE '% cycl%' OR `h` LIKE '% bicycle%' OR `h` LIKE '% bike%' OR `h` LIKE '% biking%' OR `h` LIKE '% spinning%') THEN 'cycling'
    WHEN `category` IN ('cardio', 'sport') AND `h` LIKE '% swim%' THEN 'swimming'
    WHEN `h` LIKE '% rowing%' OR `h` LIKE '% rower%' THEN 'rowing'
    WHEN `h` LIKE '% kayak%' OR `h` LIKE '% canoe%' OR `h` LIKE '% paddleboard%' THEN 'kayaking'
    WHEN `h` LIKE '% sail%' THEN 'sailing'
    WHEN `h` LIKE '% diving%' OR `h` LIKE '% scuba%' OR `h` LIKE '% snorkel%' THEN 'diving'
    WHEN `h` LIKE '% surf%' THEN 'surfing'
    WHEN `h` LIKE '% football%' OR `h` LIKE '% soccer%' THEN 'football'
    WHEN `h` LIKE '% basketball%' THEN 'basketball'
    WHEN `h` LIKE '% volleyball%' THEN 'volleyball'
    WHEN `h` LIKE '% rugby%' THEN 'rugby'
    WHEN `h` LIKE '% cricket%' THEN 'cricket'
    WHEN `h` LIKE '% hockey%' THEN 'hockey'
    WHEN `h` LIKE '% snowboard%' THEN 'snowboarding'
    WHEN `h` LIKE '% skiing%' THEN 'skiing'
    WHEN `h` LIKE '% skateboard%' THEN 'skateboarding'
    WHEN `h` LIKE '% skating%' THEN 'skating'
    WHEN `h` LIKE '% golf%' THEN 'golf'
    WHEN `h` LIKE '% hiit%' OR `h` LIKE '% circuit%' OR `h` LIKE '% crossfit%' THEN 'gym'
    ELSE 'other'
  END AS `activity`
  FROM `named`
)
UPDATE `exercise_items`
SET `activity` = (SELECT `activity` FROM `refiled` WHERE `refiled`.`id` = `exercise_items`.`id`)
WHERE `activity` = 'other';
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test --workspace server && npm run typecheck && npm run lint`
Expected: PASS — the new test, and every existing `db.test.ts` test (they count the shipped migrations from the journal, so the third one is picked up).

- [ ] **Step 5: Commit**

```bash
git add server/drizzle server/test/db.test.ts
git commit -m "feat(server): migration 0002 re-files 'other' exercises by name

Word-start patterns on the lowercased name, first match wins; running,
walking, cycling, swimming and hiking only for cardio or sport, so mobility
drills such as 'Inchworm walkouts' stay put (spec §5.1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Calendar summaries — the shared rule and `GET /api/days?from=&to=`

**Files:**
- Create: `shared/src/calendar.ts`, `shared/test/calendar.test.ts`
- Modify: `shared/src/index.ts`, `shared/src/api.ts`
- Modify: `server/src/days/days.ts`, `server/src/routes/days.ts`
- Modify: `server/test/days.test.ts`, `server/test/routes.test.ts`

**Interfaces:**
- Consumes: `buildDayView`'s target arithmetic (`baseOf`, `sumTotals`, `summarizeWorkouts`, `adjustTargets`) in `server/src/days/days.ts`.
- Produces: `calorieStatus(eatenKcal: number, targetKcal: number, goal: BodyGoal): CalorieStatus`; `type CalorieStatus = "within" | "near" | "off"`; `NEAR_SHARE = 0.1`; `MAX_SUMMARY_DAYS = 42`; `interface DaySummary { date: string; kcal: number; target_kcal: number }`; `interface DaySummaries { goal: BodyGoal; days: DaySummary[] }`; `daySummaries(sql, profile, from, to, nowIso): DaySummary[]`; the route `GET /api/days?from=&to=`.

- [ ] **Step 1: Write the failing tests**

Create `shared/test/calendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calorieStatus } from "../src/calendar.ts";

describe("calorieStatus", () => {
  it("losing or maintaining: within at or under the target, near up to 10 % over, off beyond", () => {
    for (const goal of ["lose", "maintain"] as const) {
      expect(calorieStatus(1200, 2320, goal)).toBe("within");
      expect(calorieStatus(2320, 2320, goal)).toBe("within");
      expect(calorieStatus(2321, 2320, goal)).toBe("near");
      expect(calorieStatus(2552, 2320, goal)).toBe("near"); // exactly 10 % over
      expect(calorieStatus(2553, 2320, goal)).toBe("off");
    }
  });

  it("gaining: within at or over the target, near up to 10 % under, off beyond", () => {
    expect(calorieStatus(3400, 3000, "gain")).toBe("within");
    expect(calorieStatus(3000, 3000, "gain")).toBe("within");
    expect(calorieStatus(2999, 3000, "gain")).toBe("near");
    expect(calorieStatus(2700, 3000, "gain")).toBe("near"); // exactly 10 % under
    expect(calorieStatus(2699, 3000, "gain")).toBe("off");
  });

  it("compares the numbers as the app shows them: eaten to the kcal, the target to 10", () => {
    expect(calorieStatus(2320.4, 2316, "lose")).toBe("within"); // 2320 of a target shown as 2320
    expect(calorieStatus(2320.5, 2324, "lose")).toBe("near"); // 2321 of a target shown as 2320
  });
});
```

Add to `server/test/days.test.ts` (import `daySummaries` and `buildDayView` from `../src/days/days.ts`, and `sampleExercise` if missing):

```ts
describe("day summaries", () => {
  it("list the days with food, with the eaten kcal and the adjusted target, workouts included", () => {
    db = openTestDb();
    const profile = makeProfile();
    saveProfile(db.db, profile, NOW_ISO);
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) ensureDay(db.db, profile, date, NOW_ISO);
    insertEntry(db.db, sampleEntry({ date: "2026-10-01", foods: [sampleFood({ kcal: 500 })] }), NOW_ISO);
    insertEntry(db.db, sampleEntry({ date: "2026-10-02", foods: [], exercises: [sampleExercise()] }), NOW_ISO);
    insertEntry(db.db, sampleEntry({ date: "2026-10-03", foods: [sampleFood({ kcal: 900 })], exercises: [sampleExercise({ kcal: 320 })] }), NOW_ISO);

    const got = daySummaries(db.db, profile, "2026-09-28", "2026-10-04", NOW_ISO);
    expect(got.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-03"]); // the day with only exercise is left out
    expect(got[0].kcal).toBe(500);
    expect(got[1].kcal).toBe(900);
    for (const day of got) {
      expect(day.target_kcal).toBeCloseTo(buildDayView(db.db, profile, day.date, "2026-10-03", NOW_ISO).targets.adjusted.kcal, 6);
    }
    expect(got[1].target_kcal).toBeGreaterThan(got[0].target_kcal); // the workout's add-back
  });
});
```

Add to `server/test/routes.test.ts` (import `sampleFood` from `./helpers.ts` if missing):

```ts
describe("GET /api/days?from=&to=", () => {
  it("summarises the days with food, and says which way the goal points", async () => {
    ctx = await withProfile({ goal: "gain", goal_rate_kg_week: 0.25 });
    insertEntry(ctx.db, sampleEntry({ date: "2026-10-02", foods: [sampleFood({ kcal: 2600 })] }), NOW.toISOString());
    const res = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-09-28&to=2026-11-08", headers: ctx.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ goal: "gain", days: [{ date: "2026-10-02", kcal: 2600, target_kcal: expect.any(Number) }] });
  });

  it("refuses a missing, invalid, reversed or longer than six-week range", async () => {
    ctx = await withProfile();
    const bad = ["", "?from=2026-10-01", "?from=2026-10-05&to=2026-10-01", "?from=2026-10-01&to=2026-11-12", "?from=2026-02-30&to=2026-03-01", "?from=2026-10-01&from=2026-10-02&to=2026-10-03"];
    for (const query of bad) {
      const res = await ctx.app.inject({ method: "GET", url: `/api/days${query}`, headers: ctx.headers });
      expect(res.statusCode, query).toBe(400);
      expect(res.json(), query).toEqual({ error: "bad_range" });
    }
    const sixWeeks = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-10-01&to=2026-11-11", headers: ctx.headers });
    expect(sixWeeks.statusCode).toBe(200); // exactly 42 days
  });

  it("needs a profile, and the owner's token", async () => {
    ctx = await testApp();
    const noProfile = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-10-01&to=2026-10-03", headers: ctx.headers });
    expect(noProfile.statusCode).toBe(409);
    const anonymous = await ctx.app.inject({ method: "GET", url: "/api/days?from=2026-10-01&to=2026-10-03" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace shared && npm test --workspace server -- days routes`
Expected: FAIL — `../src/calendar.ts` and `daySummaries` don't exist; `GET /api/days` is a 404.

- [ ] **Step 3: Implement**

Create `shared/src/calendar.ts`:

```ts
import type { BodyGoal } from "./vocab.ts";

export type CalorieStatus = "within" | "near" | "off";

/** "A little" off its target: up to this share of it (spec §11.1). */
export const NEAR_SHARE = 0.1;

/** The most days one calendar request covers: a six-week month grid (spec §12). */
export const MAX_SUMMARY_DAYS = 42;

/**
 * How a day went against its adjusted target (spec §11.1), compared as the app shows the numbers: eaten
 * to the nearest kcal, the target to the nearest 10. Losing or maintaining, over is the wrong way;
 * gaining, under is.
 */
export function calorieStatus(eatenKcal: number, targetKcal: number, goal: BodyGoal): CalorieStatus {
  const eaten = Math.round(eatenKcal);
  const target = Math.round(targetKcal / 10) * 10;
  const wrongWay = goal === "gain" ? target - eaten : eaten - target;
  if (wrongWay <= 0) return "within";
  return wrongWay <= target * NEAR_SHARE ? "near" : "off";
}
```

In `shared/src/index.ts`, add `export * from "./calendar.ts";`.

In `shared/src/api.ts`, add `BodyGoal` to the `./vocab.ts` type import and append:

```ts
/** One day in the calendar (spec §12): what was eaten against that day's adjusted target. */
export interface DaySummary {
  date: string;
  kcal: number;
  target_kcal: number;
}

/** What GET /api/days?from=&to= returns: the current body goal, which decides the colours' direction, and the days with food. */
export interface DaySummaries {
  goal: BodyGoal;
  days: DaySummary[];
}
```

In `server/src/days/days.ts`, add `addDays` to the `../shared.ts` imports (it re-exports `shared`) and `DaySummary` to the type imports, then append:

```ts
/** The calendar's days (spec §12): each day in [from, to] with food logged, its eaten kcal and its adjusted target. */
export function daySummaries(sql: Sql, profile: Profile, from: string, to: string, nowIso: string): DaySummary[] {
  const out: DaySummary[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const list = listEntries(sql, date);
    if (!list.some((entry) => entry.foods.length > 0)) continue;
    const snapshot = getDay(sql, date) ?? snapshotValues(profile, date, nowIso);
    const t = adjustTargets(baseOf(snapshot), snapshot.add_back_pct, snapshot.weight_kg_used, summarizeWorkouts(list));
    out.push({ date, kcal: sumTotals(list).kcal, target_kcal: t.adjusted.kcal });
  }
  return out;
}
```

(If `days.ts` imports its shared names from `../shared.ts` only as types today, add a value import line `import { addDays } from "../shared.ts";`.)

In `server/src/routes/days.ts`, import `daySummaries` with `buildDayView, ensureDay`; `MAX_SUMMARY_DAYS` and `daysBetween` with `isIsoDate` from `../shared.ts`; and `import type { DaySummaries } from "../shared.ts";`. Add inside `registerDayRoutes`, after the existing route:

```ts
  // The calendar's month (spec §12). A repeated parameter arrives as an array, which counts as missing.
  app.get<{ Querystring: Record<string, unknown> }>("/api/days", async (req, reply) => {
    const profile = getProfile(deps.db);
    if (!profile) return reply.code(409).send({ error: "no_profile" });
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!isIsoDate(from) || !isIsoDate(to) || to < from || daysBetween(from, to) + 1 > MAX_SUMMARY_DAYS) {
      return reply.code(400).send({ error: "bad_range" });
    }
    const summaries: DaySummaries = { goal: profile.goal, days: daySummaries(deps.db, profile, from, to, deps.now().toISOString()) };
    return summaries;
  });
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test --workspace shared && npm test --workspace server && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/calendar.ts shared/test/calendar.test.ts shared/src/index.ts shared/src/api.ts server/src/days/days.ts server/src/routes/days.ts server/test/days.test.ts server/test/routes.test.ts
git commit -m "feat: GET /api/days?from=&to= and the shared calorie rule for the calendar

Each day with food: eaten kcal and the adjusted target, plus the current goal;
at most 42 days. calorieStatus compares as displayed and mirrors for gain.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The day bar and the calendar

**Files:**
- Create: `web/src/components/Calendar.tsx`, `web/src/components/Calendar.test.tsx`
- Modify: `web/src/components/DayNav.tsx`, `web/src/components/DayNav.test.tsx`
- Modify: `web/src/format.ts`, `web/src/format.test.ts`, `web/src/queries.ts`, `web/src/index.css`

**Interfaces:**
- Consumes: Task 4's `calorieStatus`, `CalorieStatus`, `DaySummaries`, `DaySummary`; Task 1's `calendar_month` icon; `kcal10`, `dayLabel` from `format.ts`; `addDays` from `../shared.ts`.
- Produces: `daySubtitle(date, today)`, `dayAndMonth(date)`, `monthTitle(month)`, `thousands(n)` in `format.ts`; `useDaySummaries(from, to)` in `queries.ts`; `monthGrid(month)`, `shiftMonth(month, delta)`, `Calendar({ date, today, onPick, onClose })`; Tailwind colours `tint-within`, `tint-near`, `tint-off`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/format.test.ts` (import the new names):

```ts
describe("calendar wording", () => {
  it("puts the date in words under Today and Yesterday, and the year under an older day", () => {
    expect(daySubtitle("2026-10-04", "2026-10-04")).toBe("Sun 4 Oct");
    expect(daySubtitle("2026-10-03", "2026-10-04")).toBe("Sat 3 Oct");
    expect(daySubtitle("2026-09-28", "2026-10-04")).toBe("2026");
  });

  it("names a month, a day and a big number the way the calendar reads them", () => {
    expect(monthTitle("2026-10")).toBe("October 2026");
    expect(dayAndMonth("2026-10-03")).toBe("3 October");
    expect(thousands(2363.4)).toBe("2,363");
  });
});
```

Replace `web/src/components/DayNav.test.tsx` with:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { DayNav } from "./DayNav.tsx";

describe("DayNav", () => {
  it("labels today, with the date beneath, and cannot go into the future", () => {
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Sat 3 Oct")).toBeInTheDocument();
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

  it("shows the year under a day older than yesterday", () => {
    renderWithProviders(<DayNav date="2026-09-28" today="2026-10-03" />);
    expect(screen.getByText("Mon 28 Sept")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("opens and closes the calendar from the button in the corner", async () => {
    mockFetch(() => jsonResponse({ goal: "lose", days: [] }));
    renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
    const button = screen.getByRole("button", { name: "Calendar" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Pick a day" })).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });
});
```

Create `web/src/components/Calendar.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { DayNav } from "./DayNav.tsx";
import { monthGrid, shiftMonth } from "./Calendar.tsx";

const october = (goal: string) => ({
  goal,
  days: [
    { date: "2026-10-01", kcal: 2000, target_kcal: 2310 },
    { date: "2026-10-02", kcal: 2450, target_kcal: 2310 },
    { date: "2026-10-03", kcal: 900, target_kcal: 2310 },
  ],
});

async function openCalendar(goal = "lose") {
  const fetchMock = mockFetch(() => jsonResponse(october(goal)));
  renderWithProviders(<DayNav date="2026-10-03" today="2026-10-03" />);
  await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
  return fetchMock;
}

describe("monthGrid", () => {
  it("is six weeks from the Monday on or before the 1st", () => {
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-28");
    expect(grid[41]).toBe("2026-11-08");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("Calendar", () => {
  it("asks for the six weeks it shows and tints the past days by how they went", async () => {
    const fetchMock = await openCalendar();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/days?from=2026-09-28&to=2026-11-08");
    const first = await screen.findByRole("button", { name: "1 October: 2,000 of 2,310 kcal, within target" });
    expect(first).toHaveClass("bg-tint-within");
    expect(screen.getByRole("button", { name: "2 October: 2,450 of 2,310 kcal, up to 10\u00a0% over" })).toHaveClass("bg-tint-near");
    const today = screen.getByRole("button", { name: "3 October, today" });
    expect(today).not.toHaveClass("bg-tint-within");
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveFocus();
  });

  it("words the legend and the days for a gaining goal", async () => {
    await openCalendar("gain");
    expect(await screen.findByRole("button", { name: "2 October: 2,450 of 2,310 kcal, target reached" })).toHaveClass("bg-tint-within");
    expect(screen.getByRole("button", { name: "1 October: 2,000 of 2,310 kcal, more than 10\u00a0% under" })).toHaveClass("bg-tint-off");
    expect(screen.getByText("Target reached")).toBeInTheDocument();
  });

  it("greys out the future and never goes past the current month", async () => {
    await openCalendar();
    expect(screen.getByRole("button", { name: "4 October" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "30 September" })).toBeEnabled());
  });

  it("opens the day you pick and folds itself away", async () => {
    await openCalendar();
    await userEvent.click(await screen.findByRole("button", { name: /^1 October/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/day/2026-10-01");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when you tap outside it", async () => {
    await openCalendar();
    await userEvent.click(screen.getByTestId("calendar-scrim"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace web -- format DayNav Calendar`
Expected: FAIL — the new `format.ts` helpers, the calendar button and `Calendar.tsx` don't exist.

- [ ] **Step 3: The wording, the query and the tints**

Append to `web/src/format.ts`:

```ts
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** The day bar's second line (spec §11.1): the date in words under Today and Yesterday, the year under an older day. */
export function daySubtitle(date: string, today: string): string {
  if (date !== today && date !== addDays(today, -1)) return date.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(utc(date));
}

/** "October 2026" for "2026-10". */
export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(`${month}-01`));
}

/** "3 October", as a calendar day reads aloud. */
export function dayAndMonth(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(utc(date));
}

/** 2363.4 → "2,363". */
export function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}
```

Append to `web/src/queries.ts` (add `DaySummaries` to the `./shared.ts` type import):

```ts
/** The calendar's six weeks (spec §12); fetched again whenever the calendar opens. */
export function useDaySummaries(from: string, to: string) {
  return useQuery({
    queryKey: ["days", from, to],
    queryFn: () => api<DaySummaries>(`/api/days?from=${from}&to=${to}`),
  });
}
```

In `web/src/index.css`, add to the light `:root` block:

```css
  /* Calendar tints (spec §11.4), already mixed into the base: within target, a little off, well off. */
  --nm-tint-within: #b7d1c8;
  --nm-tint-near: #dcd1ba;
  --nm-tint-off: #dac2c0;
```

to the dark block:

```css
    --nm-tint-within: #3d544c;
    --nm-tint-near: #575042;
    --nm-tint-off: #584645;
```

and to `@theme inline`:

```css
  --color-tint-within: var(--nm-tint-within);
  --color-tint-near: var(--nm-tint-near);
  --color-tint-off: var(--nm-tint-off);
```

- [ ] **Step 4: The calendar**

Create `web/src/components/Calendar.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dayAndMonth, kcal10, monthTitle, thousands } from "../format.ts";
import { Icon } from "../icons/Icon.tsx";
import { useDaySummaries } from "../queries.ts";
import { addDays, calorieStatus } from "../shared.ts";
import type { CalorieStatus, DaySummary } from "../shared.ts";

/** The 42 days (six weeks, Monday first) of the grid that shows `month`, written "2026-10". */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** `month` moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// Losing or maintaining, the wrong way is over; gaining, it is under (spec §11.1). The space before % never breaks.
const WORDS: Record<"over" | "under", Record<CalorieStatus, string>> = {
  over: { within: "Within target", near: "Up to 10\u00a0% over", off: "More than 10\u00a0% over" },
  under: { within: "Target reached", near: "Up to 10\u00a0% under", off: "More than 10\u00a0% under" },
};
const TINT: Record<CalorieStatus, string> = { within: "bg-tint-within", near: "bg-tint-near", off: "bg-tint-off" };
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
// The day bar is 4.25rem tall below the safe area; the calendar and its scrim start under it, so the bar stays usable.
const BELOW_BAR = "top-[calc(env(safe-area-inset-top)_+_4.25rem)]";
const round = "tap raised-sm flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:opacity-30";

interface CalendarProps {
  /** The day on screen and today, as YYYY-MM-DD. */
  date: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/** The month that drops down under the day bar (spec §11.1): pick a day; past days are tinted by how they went. */
export function Calendar({ date, today, onPick, onClose }: CalendarProps) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const cells = monthGrid(month);
  const summaries = useDaySummaries(cells[0], cells[cells.length - 1]);
  const byDate = new Map<string, DaySummary>((summaries.data?.days ?? []).map((day) => [day.date, day]));
  const words = WORDS[summaries.data?.goal === "gain" ? "under" : "over"];
  const opened = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    opened.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Today is still in progress, so only earlier days are judged.
  const statusOf = (day: string): CalorieStatus | null => {
    const summary = byDate.get(day);
    return day < today && summary && summaries.data ? calorieStatus(summary.kcal, summary.target_kcal, summaries.data.goal) : null;
  };
  const nameOf = (day: string, status: CalorieStatus | null): string => {
    if (day === today) return `${dayAndMonth(day)}, today`;
    const summary = byDate.get(day);
    if (status && summary) {
      return `${dayAndMonth(day)}: ${thousands(summary.kcal)} of ${thousands(kcal10(summary.target_kcal))} kcal, ${words[status].toLowerCase()}`;
    }
    return dayAndMonth(day);
  };

  return createPortal(
    <>
      <div data-testid="calendar-scrim" aria-hidden="true" onClick={onClose} className={`fixed inset-x-0 bottom-0 ${BELOW_BAR} z-40 bg-black/30`} />
      <div role="dialog" aria-label="Pick a day" className={`fixed inset-x-0 ${BELOW_BAR} z-50 mx-auto max-w-xl px-4`}>
        <div className="raised rounded-3xl p-3">
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Previous month" className={round} onClick={() => setMonth(shiftMonth(month, -1))}>
              <Icon name="chevron_left" size={22} />
            </button>
            <p aria-live="polite" className="text-sm font-semibold">
              {monthTitle(month)}
            </p>
            <button type="button" aria-label="Next month" className={round} disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
              <Icon name="chevron_right" size={22} />
            </button>
          </div>
          <div aria-hidden="true" className="mt-2 grid grid-cols-7 text-center text-xs text-muted">
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1">
            {cells.map((day) => {
              if (day.slice(0, 7) !== month) return <span key={day} aria-hidden="true" />;
              const status = statusOf(day);
              const viewed = day === date;
              return (
                <button
                  key={day}
                  ref={viewed ? opened : undefined}
                  type="button"
                  disabled={day > today}
                  aria-label={nameOf(day, status)}
                  aria-current={day === today ? "date" : undefined}
                  aria-pressed={viewed}
                  onClick={() => onPick(day)}
                  // The viewed day is pressed in with the shadow alone, so a tint behind it still shows.
                  className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm tabular-nums disabled:opacity-40 ${status ? TINT[status] : ""} ${viewed ? "font-semibold shadow-[inset_3px_3px_6px_var(--nm-lo),inset_-3px_-3px_6px_var(--nm-hi)]" : ""} ${day === today ? "outline-2 outline-offset-1 outline-accent" : ""}`}
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
            {(["within", "near", "off"] as const).map((status) => (
              <span key={status} className="inline-flex items-center gap-1">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${TINT[status]}`} />
                {words[status]}
              </span>
            ))}
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}
```

Replace `web/src/components/DayNav.tsx` with:

```tsx
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { dayLabel, daySubtitle } from "../format.ts";
import { Icon } from "../icons/Icon.tsx";
import { addDays } from "../shared.ts";
import { Calendar } from "./Calendar.tsx";

const round = "tap flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:opacity-30";

/** The day bar (spec §11.1): ‹ the day › in the middle, the calendar in the top right corner. */
export function DayNav({ date, today }: { date: string; today: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const go = (target: string) => navigate(target >= today ? "/day/today" : `/day/${target}`);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <nav aria-label="Day" className="flex items-center justify-between gap-2 py-3">
      {/* As wide as the calendar button, so the day stays centred. */}
      <span aria-hidden="true" className="h-11 w-11" />
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous day" className={`${round} raised-sm`} onClick={() => go(addDays(date, -1))}>
          <Icon name="chevron_left" size={24} />
        </button>
        <div className="flex min-w-24 flex-col items-center">
          <span className="text-base font-semibold">{dayLabel(date, today)}</span>
          <span className="text-xs text-muted">{daySubtitle(date, today)}</span>
        </div>
        <button type="button" aria-label="Next day" className={`${round} raised-sm`} disabled={date >= today} onClick={() => go(addDays(date, 1))}>
          <Icon name="chevron_right" size={24} />
        </button>
      </div>
      <button
        ref={button}
        type="button"
        aria-label="Calendar"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${round} ${open ? "pressed text-accent-ink" : "raised-sm"}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="calendar_month" size={22} />
      </button>
      {open && (
        <Calendar
          date={date}
          today={today}
          onClose={close}
          onPick={(day) => {
            setOpen(false);
            go(day);
          }}
        />
      )}
    </nav>
  );
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test --workspace web && npm run typecheck && npm run lint && npm run build`
Expected: PASS. The build compiles the `bg-tint-*` colours and the new utilities.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Calendar.tsx web/src/components/Calendar.test.tsx web/src/components/DayNav.tsx web/src/components/DayNav.test.tsx web/src/format.ts web/src/format.test.ts web/src/queries.ts web/src/index.css
git commit -m "feat(web): the calendar drops down from the day bar, past days tinted by calories

The day bar keeps ‹ the day › centred with the calendar in the top right
corner and the date (or the year) beneath. The month opens on the viewed
day, greys out the future, words each day for screen readers and folds away
on a pick, a tap outside or Escape.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The activities card

**Files:**
- Create: `web/src/components/ActivitiesCard.tsx`, `web/src/components/ActivitiesCard.test.tsx`
- Modify: `web/src/components/SportBadge.tsx` (a `pressed` prop), `web/src/pages/TodayPage.tsx`, `web/src/pages/TodayPage.test.tsx`

**Interfaces:**
- Consumes: Task 1's `SPORTS`, `SportBadge`; Task 5's `thousands`; `timeOf` from `format.ts`; `quietButton` from `./ui.tsx`.
- Produces: `SportBadge({ …, pressed = false })`; `activityGroups(view: DayView): ActivityGroup[]` with `ActivityGroup = { key: string; entry: Entry; activity: Activity; items: ExerciseItem[]; kcal: number }`; `ActivitiesCard({ view, onEdit })`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/ActivitiesCard.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { dayView, entry, exerciseItem, foodItem } from "../test/fixtures.ts";
import { ActivitiesCard, activityGroups } from "./ActivitiesCard.tsx";

const tennis = entry({ id: "e1", logged_at: "2026-10-03T19:10:00.000Z", foods: [], exercises: [exerciseItem({ id: "x1", name: "Tennis singles", kcal: 787.5, duration_min: 90, met: 7.3, assumption: "Singles, general recreational play" })] });
const gym = entry({
  id: "e2", logged_at: "2026-10-03T19:20:00.000Z", foods: [],
  exercises: [
    exerciseItem({ id: "x2", name: "Bench press", category: "strength", activity: "gym", kcal: 100, duration_min: 20, met: 5, sets: 4, reps: 8, weight_kg: 60 }),
    exerciseItem({ id: "x3", name: "Rows", category: "strength", activity: "gym", kcal: 120, duration_min: 20, met: 5, sets: 4, reps: 10, weight_kg: 50 }),
  ],
});
const kite = entry({ id: "e3", logged_at: "2026-10-03T19:30:00.000Z", foods: [], exercises: [exerciseItem({ id: "x4", name: "Kitesurfing", activity: "kitesurfing", kcal: 900, duration_min: 120, met: 9, distance_km: 25 })] });
const breakfast = entry({ id: "e0", foods: [foodItem()] });

describe("activityGroups", () => {
  it("makes one badge per activity per entry, in time order", () => {
    const groups = activityGroups(dayView({ entries: [breakfast, tennis, gym, kite] }));
    expect(groups.map((g) => [g.activity, Math.round(g.kcal), g.items.length])).toEqual([["tennis", 788, 1], ["gym", 220, 2], ["kitesurfing", 900, 1]]);
  });
});

describe("ActivitiesCard", () => {
  it("isn't there on a day without exercise", () => {
    const { container } = render(<ActivitiesCard view={dayView({ entries: [breakfast] })} onEdit={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each activity's badge with its kcal, and the day's total burned", () => {
    render(<ActivitiesCard view={dayView({ entries: [tennis, gym, kite] })} onEdit={() => {}} />);
    const card = screen.getByRole("region", { name: "Activity" });
    expect(within(card).getByText("1,908 kcal")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Tennis singles, 788 kcal" })).toHaveTextContent("788");
    expect(within(card).getByRole("button", { name: "Bench press, Rows, 220 kcal" })).toBeInTheDocument();
  });

  it("opens one activity's details at a time, and closes them again", async () => {
    render(<ActivitiesCard view={dayView({ entries: [tennis, gym, kite] })} onEdit={() => {}} />);
    const tennisBadge = screen.getByRole("button", { name: "Tennis singles, 788 kcal" });
    await userEvent.click(tennisBadge);
    expect(tennisBadge).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Tennis details" });
    expect(within(panel).getByText("90 min · 788 kcal · MET 7.3")).toBeInTheDocument();
    expect(within(panel).getByText("Singles, general recreational play")).toBeInTheDocument();
    expect(within(panel).getByText("19:10")).toBeInTheDocument(); // the test setup pins the clock to UTC

    await userEvent.click(screen.getByRole("button", { name: "Bench press, Rows, 220 kcal" }));
    expect(tennisBadge).toHaveAttribute("aria-expanded", "false");
    const gymPanel = screen.getByRole("region", { name: "Gym details" });
    expect(within(gymPanel).getByText("20 min · 100 kcal · MET 5 · 4 × 8 × 60 kg")).toBeInTheDocument();
    expect(within(gymPanel).getByText("20 min · 120 kcal · MET 5 · 4 × 10 × 50 kg")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bench press, Rows, 220 kcal" }));
    expect(screen.queryByRole("region", { name: "Gym details" })).toBeNull();
  });

  it("shows a distance when there is one, and Edit opens the entry", async () => {
    const onEdit = vi.fn();
    render(<ActivitiesCard view={dayView({ entries: [kite] })} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "Kitesurfing, 900 kcal" }));
    expect(screen.getByText("120 min · 900 kcal · MET 9 · 25 km")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(kite);
  });
});
```

Add to `web/src/pages/TodayPage.test.tsx` (inside the existing describe; reuse its imports, adding `exerciseItem` and `within` if missing):

```tsx
  it("puts the activities card under the summary, and its Edit opens the editor", async () => {
    const ride = entry({ id: "e9", foods: [], exercises: [exerciseItem({ name: "Bike ride", activity: "cycling", kcal: 400 })] });
    mockFetch(() => jsonResponse(dayView({ entries: [ride] })));
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    const card = await screen.findByRole("region", { name: "Activity" });
    await userEvent.click(within(card).getByRole("button", { name: "Bike ride, 400 kcal" }));
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace web -- ActivitiesCard TodayPage`
Expected: FAIL — `./ActivitiesCard.tsx` doesn't exist.

- [ ] **Step 3: Implement**

In `web/src/components/SportBadge.tsx`, give `SportBadge` a `pressed` prop: its props become `{ activity: Activity; size?: number; labelled?: boolean; pressed?: boolean }` with `pressed = false`, and its class list starts with `${pressed ? "pressed" : "raised-sm"}` instead of `raised-sm` (make the `className` a template literal). Add to its doc comment: "Pressed in when its activity is the one open."

Create `web/src/components/ActivitiesCard.tsx`:

```tsx
import { useId, useState } from "react";
import { thousands, timeOf } from "../format.ts";
import type { Activity, DayView, Entry, ExerciseItem } from "../shared.ts";
import { SPORTS, SportBadge } from "./SportBadge.tsx";
import { quietButton } from "./ui.tsx";

export interface ActivityGroup {
  key: string;
  entry: Entry;
  activity: Activity;
  items: ExerciseItem[];
  kcal: number;
}

/** One badge per activity per entry, in time order: a gym session's several exercises are one badge (spec §11.1). */
export function activityGroups(view: DayView): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of view.entries) {
    for (const item of entry.exercises) {
      const key = `${entry.id}:${item.activity}`;
      const group = groups.find((g) => g.key === key);
      if (group) {
        group.items.push(item);
        group.kcal += item.kcal;
      } else {
        groups.push({ key, entry, activity: item.activity, items: [item], kcal: item.kcal });
      }
    }
  }
  return groups;
}

/** "90 min · 788 kcal · MET 7.3", with sets × reps × weight or the distance when known. */
function facts(item: ExerciseItem): string {
  return [
    item.duration_min !== null ? `${Math.round(item.duration_min)} min` : null,
    `${Math.round(item.kcal)} kcal`,
    item.met !== null ? `MET ${item.met}` : null,
    item.sets !== null && item.reps !== null ? `${item.sets} × ${item.reps}${item.weight_kg !== null ? ` × ${item.weight_kg} kg` : ""}` : null,
    item.distance_km !== null ? `${item.distance_km} km` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The day's activity at a glance, under the nutrients (spec §11.1). Only there when something was done. */
export function ActivitiesCard({ view, onEdit }: { view: DayView; onEdit: (entry: Entry) => void }) {
  const groups = activityGroups(view);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const panelId = useId();
  if (groups.length === 0) return null;
  const open = groups.find((g) => g.key === openKey) ?? null;
  const total = groups.reduce((sum, g) => sum + g.kcal, 0);
  return (
    <section aria-label="Activity" className="raised mt-3 rounded-3xl p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Activity</h2>
        <span className="text-sm">{thousands(total)} kcal</span>
      </div>
      <ul className="mt-3 flex flex-wrap justify-around gap-3">
        {groups.map((group) => {
          const isOpen = group.key === open?.key;
          return (
            <li key={group.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                aria-label={`${group.items.map((item) => item.name).join(", ")}, ${Math.round(group.kcal)} kcal`}
                onClick={() => setOpenKey(isOpen ? null : group.key)}
                className="flex w-16 flex-col items-center gap-1.5 rounded-2xl py-1"
              >
                <SportBadge activity={group.activity} size={46} labelled={false} pressed={isOpen} />
                <span className="text-sm tabular-nums">{Math.round(group.kcal)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <div id={panelId} role="region" aria-label={`${SPORTS[open.activity].label} details`} className="pressed mt-3 rounded-2xl p-3">
          <p className="text-right text-xs text-muted">{timeOf(open.entry.logged_at)}</p>
          {open.items.map((item) => (
            <div key={item.id} className="mt-1">
              <p className="font-medium">{item.name}</p>
              <p className="text-sm">{facts(item)}</p>
              {item.assumption && <p className="text-xs italic text-muted">{item.assumption}</p>}
            </div>
          ))}
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => onEdit(open.entry)} className={`${quietButton} min-h-11 text-sm text-accent-ink`}>
              Edit
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

In `web/src/pages/TodayPage.tsx`, import `ActivitiesCard` and render it right after `<Summary view={view} />`:

```tsx
        <ActivitiesCard view={view} onEdit={(entry) => setEditing({ date: view.date, entry })} />
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test --workspace web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ActivitiesCard.tsx web/src/components/ActivitiesCard.test.tsx web/src/components/SportBadge.tsx web/src/pages/TodayPage.tsx web/src/pages/TodayPage.test.tsx
git commit -m "feat(web): an activities card under the nutrients

One matte badge per activity per entry with its kcal, the day's total burned,
and a panel inside the card for the one you tap: time, minutes, kcal, MET,
sets × reps × weight or distance, the coach's note, and Edit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Live steps on the server

**Files:**
- Create: `server/src/coach/steps.ts`, `server/test/coach-steps.test.ts`
- Create: `server/src/routes/stream.ts`, `server/test/stream.test.ts`
- Modify: `server/src/coach/loop.ts`, `server/test/coach-loop.test.ts`
- Modify: `server/src/coach/process.ts`
- Modify: `server/src/routes/messages.ts`, `server/src/deps.ts`, `shared/src/api.ts`
- Modify: `server/test/helpers.ts`, `server/test/messages.test.ts`

**Interfaces:**
- Consumes: `LogItemsInput`, `UpdateEntryInput` from `server/src/coach/tools.ts`.
- Produces: `type LoopStep = { kind: "start" } | { kind: "tool"; name: string; input: unknown } | { kind: "reply" }` and `LoopInput.onStep?: (step: LoopStep) => void`; `stepText(step: LoopStep, photos: number): string`; `midSentence(name)`; `CoachDeps.onStep?: (text: string) => void`; `interface CoachStreamEvents { stored: { day: DayView }; step: { text: string }; result: MessageResult }` (shared); `openEventStream(reply, keepAliveMs): EventStream` with `send(event, data)` and `close()`; `AppDeps.streamKeepAliveMs?: number`; `KEEP_ALIVE_MS = 15_000`; `testApp({ streamKeepAliveMs, logLines })`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/coach-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { midSentence, stepText } from "../src/coach/steps.ts";
import { TOOL_EGGS, TOOL_RUN, logItemsInput } from "./helpers.ts";

describe("stepText", () => {
  it("starts by thinking, or by looking at the photos, and writes a reply after the tools", () => {
    expect(stepText({ kind: "start" }, 0)).toBe("Thinking…");
    expect(stepText({ kind: "start" }, 1)).toBe("Looking at your photo…");
    expect(stepText({ kind: "start" }, 3)).toBe("Looking at your photos…");
    expect(stepText({ kind: "reply" }, 2)).toBe("Writing a reply…");
  });

  it("names what it logs: up to three items, then how many more", () => {
    const log = (names: string[]) =>
      stepText({ kind: "tool", name: "log_items", input: logItemsInput({ foods: names.map((name) => ({ ...TOOL_EGGS, name })) }) }, 0);
    expect(log(["Fried eggs"])).toBe("Logging fried eggs…");
    expect(log(["Fried eggs", "Buttered toast"])).toBe("Logging fried eggs and buttered toast…");
    expect(log(["Fried eggs", "Buttered toast", "Baked beans"])).toBe("Logging fried eggs, buttered toast and baked beans…");
    expect(log(["Fried eggs", "Buttered toast", "Baked beans", "Tomato", "Coffee"])).toBe("Logging fried eggs, buttered toast, baked beans and 2 more…");
    const tennis = logItemsInput({ foods: [], exercises: [{ ...TOOL_RUN, name: "Tennis singles" }] });
    expect(stepText({ kind: "tool", name: "log_items", input: tennis }, 0)).toBe("Logging tennis singles…");
  });

  it("names the entry it updates", () => {
    const input = { entry_id: "e1", foods: [], exercises: [{ ...TOOL_RUN, name: "Tennis singles" }] };
    expect(stepText({ kind: "tool", name: "update_entry", input }, 0)).toBe("Updating tennis singles…");
  });

  it("says something general when a tool's input can't be read", () => {
    expect(stepText({ kind: "tool", name: "log_items", input: { nonsense: true } }, 0)).toBe("Logging…");
    expect(stepText({ kind: "tool", name: "update_entry", input: null }, 0)).toBe("Updating your log…");
    expect(stepText({ kind: "tool", name: "something_new", input: {} }, 0)).toBe("Working…");
  });
});

describe("midSentence", () => {
  it("lowercases a name's first letter unless its first word is an acronym or has another capital", () => {
    expect(midSentence("Fried eggs")).toBe("fried eggs");
    expect(midSentence("BLT sandwich")).toBe("BLT sandwich");
    expect(midSentence("McFlurry")).toBe("McFlurry");
    expect(midSentence("Big Mac")).toBe("big Mac");
    expect(midSentence("  Oat & milk chocolate biscuits ")).toBe("oat & milk chocolate biscuits");
  });
});
```

Add to `server/test/coach-loop.test.ts` (import `LoopStep` as a type from `../src/coach/loop.ts`):

```ts
  it("says what it is about to do: its first look, each tool, then the reply after the tools", async () => {
    const steps: LoopStep[] = [];
    const ai = fakeAi([toolCall([{ name: "log_items", input: { a: 1 } }, { name: "update_entry", input: { b: 2 } }]), textReply("Logged.")]);
    await runCoachLoop(input(ai, { onStep: (step) => steps.push(step) }));
    expect(steps).toEqual([
      { kind: "start" },
      { kind: "tool", name: "log_items", input: { a: 1 } },
      { kind: "tool", name: "update_entry", input: { b: 2 } },
      { kind: "reply" },
    ]);
  });
```

Create `server/test/stream.test.ts`:

```ts
import type { FastifyReply } from "fastify";
import type { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { openEventStream } from "../src/routes/stream.ts";

/** Just enough of a Fastify reply to see what the stream does with it. */
function fakeReply() {
  const sent: { status: number; headers: Record<string, string>; body: PassThrough | null } = { status: 0, headers: {}, body: null };
  const reply = {
    code(status: number) {
      sent.status = status;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    send(body: PassThrough) {
      sent.body = body;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

describe("openEventStream", () => {
  it("answers 200 as text/event-stream and writes each event as event and data lines", async () => {
    const { reply, sent } = fakeReply();
    const stream = openEventStream(reply, 60_000);
    stream.send("step", { text: "Thinking…" });
    stream.close();
    expect(sent.status).toBe(200);
    expect(sent.headers).toEqual({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
    let written = "";
    for await (const chunk of sent.body as PassThrough) written += String(chunk);
    expect(written).toBe('event: step\ndata: {"text":"Thinking…"}\n\n');
  });

  it("drops what it is given once the phone has gone, without throwing", () => {
    const { reply, sent } = fakeReply();
    const stream = openEventStream(reply, 5);
    sent.body?.destroy();
    expect(() => {
      stream.send("step", { text: "Thinking…" });
      stream.close();
    }).not.toThrow();
  });
});
```

In `server/test/helpers.ts`, let `testApp` take two more options and pass them on:

```ts
export async function testApp(opts: { now?: Date; webDist?: string | null; ai?: AiClient | null; coachBudgetMs?: number; metrics?: Metrics; streamKeepAliveMs?: number; logLines?: string[] } = {}) {
```

and in its `buildApp({ … })` call add:

```ts
    streamKeepAliveMs: opts.streamKeepAliveMs,
    logger: opts.logLines !== undefined,
    logStream: opts.logLines ? { write: (line: string) => void opts.logLines?.push(line) } : undefined,
```

Add to `server/test/messages.test.ts` (import `testApp` is already there):

```ts
function streamed(app: TestApp, body: { id?: string; text?: string; photo_ids?: string[] }) {
  const { id = randomUUID(), ...rest } = body;
  return app.app.inject({
    method: "POST", url: "/api/messages", headers: { ...app.headers, accept: "text/event-stream" },
    payload: { id, sent_at: "2026-10-03T11:58:00.000Z", text: "", photo_ids: [], ...rest },
  });
}

/** The events of a text/event-stream body, comments left out. */
function eventsOf(payload: string): { event: string; data: any }[] {
  return payload
    .split("\n\n")
    .filter((block) => block.trim() !== "" && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const data = JSON.parse(lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "null");
      return { event, data };
    });
}

describe("POST /api/messages, streamed (spec §6.3)", () => {
  it("streams stored, then what the coach is doing, then the result", async () => {
    const { app } = await appWith([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged 2 scrambled eggs, 180 kcal.")]);
    const res = await streamed(app, { text: "2 scrambled eggs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    const events = eventsOf(res.payload);
    expect(events.map((e) => e.event)).toEqual(["stored", "step", "step", "step", "result"]);
    expect(events[0].data.day.messages).toEqual([expect.objectContaining({ text: "2 scrambled eggs", status: "pending" })]);
    expect(events.slice(1, 4).map((e) => e.data.text)).toEqual(["Thinking…", "Logging scrambled eggs…", "Writing a reply…"]);
    expect(events[4].data.user).toMatchObject({ status: "done" });
    expect(events[4].data.reply.text).toBe("Logged 2 scrambled eggs, 180 kcal.");
    expect(events[4].data.day.entries).toHaveLength(1);
  });

  it("looks at the photo, or the photos, first", async () => {
    const { app } = await appWith([textReply("A plate."), textReply("Two plates.")]);
    expect(eventsOf((await streamed(app, { photo_ids: [addPhoto(app)] })).payload)[1]).toEqual({ event: "step", data: { text: "Looking at your photo…" } });
    expect(eventsOf((await streamed(app, { photo_ids: [addPhoto(app), addPhoto(app)] })).payload)[1]).toEqual({ event: "step", data: { text: "Looking at your photos…" } });
  });

  it("ends a failed message with its result", async () => {
    const { app } = await appWith([new AiError("api_error", "boom")]);
    const events = eventsOf((await streamed(app, { text: "hello" })).payload);
    expect(events.map((e) => e.event)).toEqual(["stored", "step", "result"]);
    expect(events[2].data.user).toMatchObject({ status: "failed", error_code: "ai_error" });
  });

  it("answers a refusal before storing, and a finished repeat, with plain JSON", async () => {
    const { app } = await appWith([textReply("Hi!")]);
    const refused = await streamed(app, { photo_ids: ["0".repeat(32)] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: "photo_not_found" });
    const id = randomUUID();
    await streamed(app, { id, text: "hello" });
    const again = await streamed(app, { id, text: "hello" });
    expect(again.statusCode).toBe(200);
    expect(again.headers["content-type"]).toContain("application/json");
    expect(again.json().reply.text).toBe("Hi!");
  });

  it("keeps the connection open while the coach thinks", async () => {
    const slow: FakeStep = () => new Promise((resolve) => setTimeout(() => resolve(textReply("Done.")), 60));
    ctx = await testApp({ ai: fakeAi([slow]), streamKeepAliveMs: 10 });
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    const res = await streamed(ctx, { text: "hello" });
    expect(res.payload).toContain(": keep-alive\n\n");
    expect(eventsOf(res.payload).at(-1)?.event).toBe("result");
  });

  it("streams a Retry the same way", async () => {
    const { app } = await appWith([new AiError("api_error", "boom"), textReply("Back again.")]);
    const id = randomUUID();
    await streamed(app, { id, text: "hello" });
    const res = await app.app.inject({ method: "POST", url: `/api/messages/${id}/retry`, headers: { ...app.headers, accept: "text/event-stream" } });
    const events = eventsOf(res.payload);
    expect(events.map((e) => e.event)).toEqual(["stored", "step", "result"]);
    expect(events[0].data.day.messages[0]).toMatchObject({ id, status: "pending" });
    expect(events[2].data.reply.text).toBe("Back again.");
  });

  it("never writes a step to the log", async () => {
    const logLines: string[] = [];
    ctx = await testApp({ ai: fakeAi([toolCall([{ name: "log_items", input: logItemsInput() }]), textReply("Logged.")]), logLines });
    saveProfile(ctx.db, makeProfile(), NOW.toISOString());
    await streamed(ctx, { text: "2 scrambled eggs" });
    expect(logLines.join("")).not.toMatch(/scrambled/i);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace server -- coach-steps coach-loop stream messages`
Expected: FAIL — `steps.ts` and `stream.ts` don't exist, `onStep` is never called, and a streamed request gets the old JSON `201`.

- [ ] **Step 3: The steps and the loop**

Create `server/src/coach/steps.ts`:

```ts
import type { LoopStep } from "./loop.ts";
import { LogItemsInput, UpdateEntryInput } from "./tools.ts";

/** A name as it reads mid-sentence: "Fried eggs" becomes "fried eggs", but "BLT sandwich" and "McFlurry" keep their capitals. */
export function midSentence(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  const acronym = first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first);
  const innerCapital = /[A-Z]/.test(first.slice(1));
  return acronym || innerCapital ? trimmed : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
function listOf(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** What the coach is doing, in the words the phone shows (spec §6.3). Steps never reach the log: they name foods. */
export function stepText(step: LoopStep, photos: number): string {
  if (step.kind === "start") return photos === 0 ? "Thinking…" : photos === 1 ? "Looking at your photo…" : "Looking at your photos…";
  if (step.kind === "reply") return "Writing a reply…";
  if (step.name === "log_items") {
    const parsed = LogItemsInput.safeParse(step.input);
    const names = parsed.success ? [...parsed.data.foods, ...parsed.data.exercises].map((item) => midSentence(item.name)).filter(Boolean) : [];
    return names.length > 0 ? `Logging ${listOf(names)}…` : "Logging…";
  }
  if (step.name === "update_entry") {
    const parsed = UpdateEntryInput.safeParse(step.input);
    const first = parsed.success ? [...parsed.data.foods, ...parsed.data.exercises][0]?.name : undefined;
    return first ? `Updating ${midSentence(first)}…` : "Updating your log…";
  }
  return "Working…";
}
```

In `server/src/coach/loop.ts`, add after `CoachFailure`:

```ts
/** What the coach is about to do (spec §6.3): its first look, a tool, or a reply once tools have run. */
export type LoopStep = { kind: "start" } | { kind: "tool"; name: string; input: unknown } | { kind: "reply" };
```

add to `LoopInput`:

```ts
  /** Told before each model call and each tool, for the live steps. */
  onStep?: (step: LoopStep) => void;
```

in `runCoachLoop`, right after `calls += 1;`:

```ts
    input.onStep?.(calls === 1 ? { kind: "start" } : { kind: "reply" });
```

and inside the `toolUses.map` callback, before `input.execute(…)`:

```ts
      input.onStep?.({ kind: "tool", name: use.name, input: use.input });
```

In `server/src/coach/process.ts`, import `type { LoopStep }` from `./loop.ts` and `{ stepText }` from `./steps.ts`; add to `CoachDeps`:

```ts
  /** Hears each step of the work (spec §6.3). Best effort: it can never stop the coach. */
  onStep?: (text: string) => void;
```

and before `const result = await withBudget(…)`:

```ts
  const onStep = deps.onStep;
  const photos = message.photo_ids.length;
  const report = onStep
    ? (step: LoopStep) => {
        try {
          onStep(stepText(step, photos));
        } catch {
          // Telling the phone how it is going must never cost the message.
        }
      }
    : undefined;
```

then pass `onStep: report,` in the object given to `runCoachLoop`.

- [ ] **Step 4: The stream and the routes**

Add to `shared/src/api.ts`:

```ts
/** The live steps' events (spec §6.3), as POST /api/messages and Retry stream them when asked to. */
export interface CoachStreamEvents {
  stored: { day: DayView };
  step: { text: string };
  result: MessageResult;
}
```

Create `server/src/routes/stream.ts`:

```ts
import { PassThrough } from "node:stream";
import type { FastifyReply } from "fastify";
import type { CoachStreamEvents } from "../shared.ts";

export interface EventStream {
  send<K extends keyof CoachStreamEvents>(event: K, data: CoachStreamEvents[K]): void;
  close(): void;
}

/**
 * Answers with text/event-stream (spec §6.3) and returns the means to write to it. no-transform keeps
 * Cloudflare from holding events back. Anything written after the phone has gone is dropped: the work
 * behind a stream never depends on someone still listening.
 */
export function openEventStream(reply: FastifyReply, keepAliveMs: number): EventStream {
  const body = new PassThrough();
  // A connection that closes mid-write is expected, not a crash.
  body.on("error", () => {});
  const write = (chunk: string) => {
    if (!body.destroyed && !body.writableEnded) body.write(chunk);
  };
  const timer = setInterval(() => write(": keep-alive\n\n"), keepAliveMs);
  reply
    .code(200)
    .header("content-type", "text/event-stream; charset=utf-8")
    .header("cache-control", "no-cache, no-transform")
    .header("x-accel-buffering", "no");
  void reply.send(body);
  return {
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => {
      clearInterval(timer);
      if (!body.destroyed && !body.writableEnded) body.end();
    },
  };
}
```

In `server/src/deps.ts`, add to `AppDeps`:

```ts
  /** How often a live-steps stream says it is still there (spec §6.3); 15 s unless a test changes it. */
  streamKeepAliveMs?: number;
```

In `server/src/routes/messages.ts`:
- change the fastify type import to `import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";`, add `DayView` to the `../shared.ts` type import and `import { openEventStream } from "./stream.ts";`;
- give `runSafely` a fourth parameter `onStep?: (text: string) => void` and pass `onStep` in the object it gives `processMessage`;
- add, after `messageResult`:

```ts
/** How often a stream says it is still there while the coach thinks (spec §6.3). */
export const KEEP_ALIVE_MS = 15_000;

/** True when the phone asked to follow the coach's work as it happens (spec §6.3). */
function wantsStream(req: FastifyRequest): boolean {
  return (req.headers.accept ?? "").includes("text/event-stream");
}

/** The message's day as it stands now. */
function dayOf(deps: AppDeps, date: string): DayView {
  const profile = getProfile(deps.db);
  if (!profile) throw new Error("the profile disappeared");
  const now = deps.now();
  return buildDayView(deps.db, profile, date, todayIn(profile.timezone, now), now.toISOString());
}

/**
 * Runs a stored message through the coach as a stream: stored, each step, then the result. The coach's work
 * never depends on the stream: if an event can't be built, the stream ends without it and the phone looks again.
 */
async function streamWork(deps: AppDeps, req: FastifyRequest, reply: FastifyReply, id: string, date: string): Promise<FastifyReply> {
  const stream = openEventStream(reply, deps.streamKeepAliveMs ?? KEEP_ALIVE_MS);
  try {
    try {
      stream.send("stored", { day: dayOf(deps, date) });
    } catch (err) {
      req.log.error({ err }, "the stored event could not be built");
    }
    await runSafely(deps, id, req.log, (text) => stream.send("step", { text }));
    try {
      stream.send("result", messageResult(deps, id));
    } catch (err) {
      req.log.error({ err }, "the result event could not be built");
    }
  } finally {
    stream.close();
  }
  return reply;
}
```

- in `POST /api/messages`, replace the last two lines (`await runSafely(…)` and `return reply.code(201)…`) with:

```ts
    if (wantsStream(req)) return streamWork(deps, req, reply, input.id, date);
    await runSafely(deps, input.id, req.log);
    return reply.code(201).send(messageResult(deps, input.id));
```

- in `POST /api/messages/:id/retry`, replace the two lines after `setMessageStatus(…, "pending", null);` with:

```ts
    if (wantsStream(req)) return streamWork(deps, req, reply, existing.id, existing.date);
    await runSafely(deps, existing.id, req.log);
    return messageResult(deps, existing.id);
```

Everything before those lines — validation, `no_profile`, the repeated id, the photo claim, `not_found` and `not_failed` — stays exactly as it is, so those answers stay JSON.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test --workspace server && npm run typecheck && npm run lint`
Expected: PASS, including every existing message test (they send no `accept` header, so they still get JSON).

- [ ] **Step 6: Commit**

```bash
git add shared/src/api.ts server/src/coach/steps.ts server/src/coach/loop.ts server/src/coach/process.ts server/src/routes/stream.ts server/src/routes/messages.ts server/src/deps.ts server/test/coach-steps.test.ts server/test/coach-loop.test.ts server/test/stream.test.ts server/test/helpers.ts server/test/messages.test.ts
git commit -m "feat(server): live steps — sends and retries stream stored, step and result

A request asking for text/event-stream gets the coach's work as it happens:
'Thinking…' or 'Looking at your photo…', 'Logging fried eggs…', 'Writing a
reply…', then the usual result. Refusals and finished repeats stay JSON; a
keep-alive comment every 15 s; the work never depends on the connection, and
steps never reach the log.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The phone follows a stream

**Files:**
- Modify: `web/src/api.ts`, `web/src/api.test.ts`
- Create: `web/src/coach/stream.ts`, `web/src/coach/stream.test.ts`
- Create: `web/src/coach/live.ts`, `web/src/coach/live.test.tsx`

**Interfaces:**
- Consumes: Task 7's `CoachStreamEvents`, `MessageResult`, `DayView` from `../shared.ts`.
- Produces: `responseError(res: Response): Promise<ApiError | null>`; `type CoachEvent = { type: "stored"; day: DayView } | { type: "step"; text: string }`; `streamCoach(path: string, json: unknown, onEvent: (event: CoachEvent) => void): Promise<MessageResult>` (throws `ApiError`; code `stream_dropped` when the stream ends without a result); `MIN_STEP_MS = 1500`; `firstStep(photos: number): string`; `startLive(id, first)`, `pushStep(id, text)`, `finishLive(id)`, `dropLive(id)`, `isLive(id)`, `useStep(id): string | undefined`, `resetLive()`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/coach/stream.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { onSignedOut } from "../api.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch } from "../test/render.tsx";
import { streamCoach } from "./stream.ts";
import type { CoachEvent } from "./stream.ts";

/** A text/event-stream answer that arrives in the given pieces. */
function sse(pieces: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const result = { user: message({ status: "done" }), reply: message({ id: "r1", role: "assistant", text: "Logged.", status: null }), day: dayView() };

describe("streamCoach", () => {
  it("asks for a stream, reports stored and each step, and resolves with the result", async () => {
    const whole = event("stored", { day: dayView() }) + ": keep-alive\n\n" + event("step", { text: "Thinking…" }) + event("result", result);
    // Cut mid-event, so the pieces must be put back together.
    const fetchMock = mockFetch(() => sse([whole.slice(0, 17), whole.slice(17, 90), whole.slice(90)]));
    const events: CoachEvent[] = [];
    await expect(streamCoach("/api/messages", { id: "m1", text: "eggs" }, (e) => events.push(e))).resolves.toEqual(result);
    expect(events).toEqual([{ type: "stored", day: dayView() }, { type: "step", text: "Thinking…" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", credentials: "same-origin", body: JSON.stringify({ id: "m1", text: "eggs" }) });
    expect(init?.headers).toEqual({ accept: "text/event-stream", "content-type": "application/json" });
  });

  it("sends a Retry with no body", async () => {
    const fetchMock = mockFetch(() => sse([event("result", result)]));
    await streamCoach("/api/messages/m1/retry", undefined, () => {});
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ accept: "text/event-stream" });
  });

  it("takes a plain JSON answer as the result", async () => {
    mockFetch(() => jsonResponse(result));
    const onEvent = vi.fn();
    await expect(streamCoach("/api/messages", {}, onEvent)).resolves.toEqual(result);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("says offline when the request can't be made, and passes on the server's refusals", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "offline", code: "offline" });
    mockFetch(() => jsonResponse({ error: "photo_taken" }, 409));
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "http", status: 409, code: "photo_taken" });
  });

  it("notices an expired sign-in", async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    mockFetch(() => new Response(null, { status: 401 }));
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "signed_out" });
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it("says the stream dropped when it ends without a result", async () => {
    mockFetch(() => sse([event("stored", { day: dayView() }), event("step", { text: "Thinking…" })]));
    await expect(streamCoach("/api/messages", {}, () => {})).rejects.toMatchObject({ kind: "offline", code: "stream_dropped" });
  });
});
```

Create `web/src/coach/live.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_STEP_MS, dropLive, finishLive, firstStep, isLive, pushStep, resetLive, startLive, useStep } from "./live.ts";

function Step({ id }: { id: string }) {
  return <output data-testid={id}>{useStep(id) ?? "none"}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLive();
});
afterEach(() => {
  resetLive();
  vi.useRealTimers();
});

describe("live steps", () => {
  it("starts with the photo-aware first words", () => {
    expect([firstStep(0), firstStep(1), firstStep(2)]).toEqual(["Thinking…", "Looking at your photo…", "Looking at your photos…"]);
  });

  it("shows the first words at once and holds each later step for at least 1.5 s", () => {
    render(<Step id="m1" />);
    act(() => startLive("m1", "Thinking…"));
    expect(screen.getByTestId("m1")).toHaveTextContent("Thinking…");
    act(() => {
      vi.advanceTimersByTime(9000);
      pushStep("m1", "Logging fried eggs…");
      pushStep("m1", "Writing a reply…");
    });
    expect(screen.getByTestId("m1")).toHaveTextContent("Logging fried eggs…");
    act(() => vi.advanceTimersByTime(MIN_STEP_MS - 1));
    expect(screen.getByTestId("m1")).toHaveTextContent("Logging fried eggs…");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("m1")).toHaveTextContent("Writing a reply…");
  });

  it("holds the first words too when a step comes straight after them", () => {
    render(<Step id="m1" />);
    act(() => {
      startLive("m1", "Thinking…");
      pushStep("m1", "Logging…");
    });
    expect(screen.getByTestId("m1")).toHaveTextContent("Thinking…");
    act(() => vi.advanceTimersByTime(MIN_STEP_MS));
    expect(screen.getByTestId("m1")).toHaveTextContent("Logging…");
  });

  it("forgets the steps when the reply arrives, and keeps the latest one when the stream drops", () => {
    render(
      <>
        <Step id="a" />
        <Step id="b" />
      </>,
    );
    act(() => {
      startLive("a", "Thinking…");
      startLive("b", "Thinking…");
      pushStep("b", "Writing a reply…");
    });
    expect(isLive("a")).toBe(true);
    act(() => {
      finishLive("a");
      dropLive("b");
    });
    expect(isLive("a")).toBe(false);
    expect(isLive("b")).toBe(false);
    expect(screen.getByTestId("a")).toHaveTextContent("none");
    expect(screen.getByTestId("b")).toHaveTextContent("Writing a reply…");
  });

  it("ignores a step for a message that isn't streaming", () => {
    pushStep("x", "Thinking…");
    expect(isLive("x")).toBe(false);
  });
});
```

Add to `web/src/api.test.ts` (import `responseError`):

```ts
describe("responseError", () => {
  it("is null for a success, the server's code for a refusal, and signed out for a redirect or a 401", async () => {
    expect(await responseError(new Response("{}", { status: 200 }))).toBeNull();
    expect(await responseError(new Response(JSON.stringify({ error: "too_old" }), { status: 400 }))).toMatchObject({ kind: "http", status: 400, code: "too_old" });
    expect(await responseError(new Response(null, { status: 401 }))).toMatchObject({ kind: "signed_out" });
    expect(await responseError(new Response(null, { status: 302 }))).toMatchObject({ kind: "signed_out" });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace web -- stream live api`
Expected: FAIL — the modules and `responseError` don't exist.

- [ ] **Step 3: Implement**

In `web/src/api.ts`, move the response checks out of `api()` into an exported function, and use it:

```ts
/** The ApiError a response stands for, or null when it is a success. A redirect or a 401 means the Access session expired. */
export async function responseError(res: Response): Promise<ApiError | null> {
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 401) {
    for (const listener of signedOutListeners) {
      try {
        listener();
      } catch {
        // A failing listener must not hide the sign-out or starve the listeners after it.
      }
    }
    return new ApiError("signed_out", res.status, "signed_out", "Signed out");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error : "http_error";
    return new ApiError("http", res.status, code, `Request failed (${res.status})`);
  }
  return null;
}
```

and in `api()` replace the two `if` blocks after the `fetch` with:

```ts
  const failure = await responseError(res);
  if (failure) throw failure;
```

Create `web/src/coach/stream.ts`:

```ts
import { ApiError, responseError } from "../api.ts";
import type { CoachStreamEvents, DayView, MessageResult } from "../shared.ts";

export type CoachEvent = { type: "stored"; day: DayView } | { type: "step"; text: string };

/** One event out of a text/event-stream block; comments (": keep-alive") and anything unreadable come back null. */
function parse(block: string): { name: string; data: unknown } | null {
  let name = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!name || !data) return null;
  try {
    return { name, data: JSON.parse(data) as unknown };
  } catch {
    return null;
  }
}

/**
 * Sends a message, or a Retry, and follows the coach's work as it happens (spec §6.3). Resolves with the
 * result. Throws an ApiError as api() does — and one with the code "stream_dropped" when the stream ends
 * without a result, in which case the message may still be with the coach.
 */
export async function streamCoach(path: string, json: unknown, onEvent: (event: CoachEvent) => void): Promise<MessageResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      redirect: "manual",
      credentials: "same-origin",
      headers: json === undefined ? { accept: "text/event-stream" } : { accept: "text/event-stream", "content-type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError("offline", 0, "offline", "You appear to be offline.");
  }
  const failure = await responseError(res);
  if (failure) throw failure;
  // A finished repeat, or a server from before live steps, answers in one piece.
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
    try {
      return (await res.json()) as MessageResult;
    } catch {
      throw new ApiError("http", res.status, "bad_response", "The server sent something that is not JSON.");
    }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const parsed = parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
        if (!parsed) continue;
        if (parsed.name === "result") return parsed.data as CoachStreamEvents["result"];
        if (parsed.name === "stored") onEvent({ type: "stored", day: (parsed.data as CoachStreamEvents["stored"]).day });
        if (parsed.name === "step") onEvent({ type: "step", text: (parsed.data as CoachStreamEvents["step"]).text });
      }
    }
  } catch {
    // The connection broke mid-stream: the same as a stream that ended early.
  }
  throw new ApiError("offline", 0, "stream_dropped", "The connection closed before the reply arrived.");
}
```

Create `web/src/coach/live.ts`:

```ts
import { useSyncExternalStore } from "react";

/** The least time a step stays on screen, so one that ends at once is still readable (spec §11.1). */
export const MIN_STEP_MS = 1500;

/** The words under a message the moment it is sent, before the server says anything (spec §11.1). */
export function firstStep(photos: number): string {
  return photos === 0 ? "Thinking…" : photos === 1 ? "Looking at your photo…" : "Looking at your photos…";
}

interface Showing {
  text: string;
  since: number;
  queue: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

// The steps of every message whose stream is open, and the latest step of any whose stream dropped.
const live = new Map<string, Showing>();
const last = new Map<string, string>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

function stopTimer(id: string): void {
  const showing = live.get(id);
  if (showing?.timer) clearTimeout(showing.timer);
}

/** True while a send or a Retry streams this message: its steps arrive on the stream, so the pending poll leaves it be. */
export function isLive(id: string): boolean {
  return live.has(id);
}

/** A stream opens: show its first words at once. */
export function startLive(id: string, first: string): void {
  stopTimer(id);
  last.delete(id);
  live.set(id, { text: first, since: Date.now(), queue: [], timer: null });
  changed();
}

function advance(id: string): void {
  const showing = live.get(id);
  if (!showing || showing.timer !== null || showing.queue.length === 0) return;
  const wait = showing.since + MIN_STEP_MS - Date.now();
  if (wait > 0) {
    showing.timer = setTimeout(() => {
      showing.timer = null;
      advance(id);
    }, wait);
    return;
  }
  showing.text = showing.queue.shift() as string;
  showing.since = Date.now();
  changed();
  advance(id);
}

/** A step arrives: it shows once the one before has had its time. */
export function pushStep(id: string, text: string): void {
  const showing = live.get(id);
  if (!showing) return;
  showing.queue.push(text);
  advance(id);
}

/** The reply arrived: forget the steps. */
export function finishLive(id: string): void {
  stopTimer(id);
  live.delete(id);
  last.delete(id);
  changed();
}

/** The stream dropped before the reply: keep the latest step on screen while the pending poll looks for the reply. */
export function dropLive(id: string): void {
  const showing = live.get(id);
  stopTimer(id);
  live.delete(id);
  if (showing) last.set(id, showing.queue[showing.queue.length - 1] ?? showing.text);
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The step to show under a pending message, when one is known. */
export function useStep(id: string): string | undefined {
  return useSyncExternalStore(subscribe, () => live.get(id)?.text ?? last.get(id));
}

/** Tests only: start from nothing. */
export function resetLive(): void {
  for (const id of live.keys()) stopTimer(id);
  live.clear();
  last.clear();
  changed();
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test --workspace web && npm run typecheck && npm run lint`
Expected: PASS, the existing `api.test.ts` included.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts web/src/coach/stream.ts web/src/coach/stream.test.ts web/src/coach/live.ts web/src/coach/live.test.tsx
git commit -m "feat(web): follow the coach's stream, and hold each step for 1.5 s

streamCoach posts with Accept: text/event-stream, reports stored and each
step, resolves with the result, takes a plain JSON answer as the result, and
says stream_dropped when the stream ends early. The live store shows a
message's steps, each for at least 1.5 s, and keeps the latest when a stream
drops.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Instant sending — the composer, the feed, Retry and the poll

**Files:**
- Create: `web/src/coach/pending.ts`, `web/src/pages/TodayPage.live.test.tsx`
- Modify: `web/src/components/Composer.tsx`, `web/src/components/Composer.photos.test.tsx`
- Modify: `web/src/components/Feed.tsx`, `web/src/pages/TodayPage.tsx`, `web/src/pages/TodayPage.pending.test.tsx`, `web/src/queries.ts`

**Interfaces:**
- Consumes: Task 8's `streamCoach`, `firstStep`, `startLive`, `pushStep`, `finishLive`, `dropLive`, `isLive`, `useStep`, `resetLive`; `storeDay`, `dayKey`.
- Produces: `pendingMessage(input, date): ChatMessage`, `addPending(client, input)`, `removePending(client, id)`, `markPending(client, view, id)`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/pages/TodayPage.live.test.tsx`:

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_STEP_MS, resetLive } from "../coach/live.ts";
import type { MessageInput } from "../shared.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { TodayPage } from "./TodayPage.tsx";

/** A streamed answer whose events the test writes one at a time. */
function controlledStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }),
    send: (event: string, data: unknown) => controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    end: () => controller?.close(),
  };
}

const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetLive();
});
afterEach(() => {
  resetLive();
  vi.useRealTimers();
});

describe("TodayPage, sending (spec §11.1)", () => {
  it("puts the message in the feed at once, shows the coach's steps, then the reply", async () => {
    const stream = controlledStream();
    let posted: MessageInput | null = null;
    mockFetch((url, init) => {
      if (url === "/api/messages") {
        posted = JSON.parse(String(init?.body)) as MessageInput;
        return stream.response;
      }
      return jsonResponse(dayView());
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.type(await screen.findByLabelText("Message your coach"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("2 eggs")).toBeInTheDocument();
    expect(screen.getByLabelText("Message your coach")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");

    const id = (posted as MessageInput | null)?.id ?? "";
    const pending = message({ id, text: "2 eggs", status: "pending", sent_at: "2026-10-03T07:09:00.000Z" });
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    act(() => stream.send("step", { text: "Logging eggs…" }));
    await act(() => vi.advanceTimersByTimeAsync(MIN_STEP_MS));
    expect(screen.getByRole("status")).toHaveTextContent("Logging eggs…");

    const reply = message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: id, created_at: "2026-10-03T07:09:30.000Z" });
    act(() => {
      stream.send("result", { user: { ...pending, status: "done" }, reply, day: dayView({ messages: [{ ...pending, status: "done" }, reply] }) });
      stream.end();
    });
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("puts the text back in the composer when the message never reached the server", async () => {
    mockFetch((url) => {
      if (url === "/api/messages") throw new TypeError("Failed to fetch");
      return jsonResponse(dayView());
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.type(await screen.findByLabelText("Message your coach"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Message your coach")).toHaveValue("2 eggs");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets the poll find the reply when the stream drops after the message was stored", async () => {
    const stream = controlledStream();
    let id = "";
    let loads = 0;
    mockFetch((url, init) => {
      if (url === "/api/messages") {
        id = (JSON.parse(String(init?.body)) as MessageInput).id;
        return stream.response;
      }
      loads += 1;
      const pending = message({ id, text: "2 eggs", status: "pending" });
      if (loads <= 2) return jsonResponse(dayView({ messages: id ? [pending] : [] }));
      const reply = message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: id, created_at: "2026-10-03T07:09:30.000Z" });
      return jsonResponse(dayView({ messages: [{ ...pending, status: "done" }, reply] }));
    });
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.type(await screen.findByLabelText("Message your coach"), "2 eggs");
    await user.click(screen.getByRole("button", { name: "Send" }));
    act(() => stream.send("stored", { day: dayView({ messages: [message({ id, text: "2 eggs", status: "pending" })] }) }));
    act(() => stream.end());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Thinking…"));
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });

  it("streams a Retry: the failed message shows the coach working again, then the reply", async () => {
    const stream = controlledStream();
    const failed = message({ id: "m1", text: "2 eggs", status: "failed", error_code: "timeout" });
    mockFetch((url) => (url === "/api/messages/m1/retry" ? stream.response : jsonResponse(dayView({ messages: [failed] }))));
    renderWithProviders(<TodayPage />, { route: "/day/today", path: "/day/:date" });
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    const pending = { ...failed, status: "pending" as const, error_code: null };
    act(() => stream.send("stored", { day: dayView({ messages: [pending] }) }));
    const reply = message({ id: "r1", role: "assistant", text: "Logged 2 eggs.", status: null, reply_to: "m1", created_at: "2026-10-03T07:09:30.000Z" });
    act(() => {
      stream.send("result", { user: { ...pending, status: "done" }, reply, day: dayView({ messages: [{ ...pending, status: "done" }, reply] }) });
      stream.end();
    });
    expect(await screen.findByText("Logged 2 eggs.")).toBeInTheDocument();
  });
});
```

In `web/src/pages/TodayPage.pending.test.tsx`, a message seen pending through the poll now shows the coach working, not "Sending…": replace both `"Sending…"` with `"Thinking…"`.

In `web/src/components/Composer.photos.test.tsx`, replace the test `"locks itself while the message is on its way, then clears the photos"` with:

```tsx
  it("clears the photos at once and stays locked until the server has the message", async () => {
    let arrive: (res: Response) => void = () => {};
    mockFetch((url) => (url === "/api/photos" ? uploaded("9".repeat(32)) : new Promise<Response>((resolve) => (arrive = resolve))));
    renderWithProviders(<Composer />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByLabelText("Add photos")).toBeDisabled();
    expect(screen.getByLabelText("Message your coach")).toHaveAttribute("readonly");
    arrive(stored());
    await waitFor(() => expect(screen.getByLabelText("Add photos")).toBeEnabled());
    expect(screen.getByLabelText("Message your coach")).not.toHaveAttribute("readonly");
  });

  it("puts the photos back when the message never reached the server", async () => {
    let sends = 0;
    mockFetch((url) => {
      if (url === "/api/photos") return uploaded("9".repeat(32));
      sends += 1;
      throw new TypeError("Failed to fetch");
    });
    renderWithProviders(<Composer />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    expect(sends).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace web -- TodayPage Composer`
Expected: FAIL — the message only appears when the whole answer has arrived, and nothing shows the coach's steps.

- [ ] **Step 3: The pending message and the poll**

Create `web/src/coach/pending.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { dayKey, storeDay } from "../queries.ts";
import type { ChatMessage, DayView, MessageInput } from "../shared.ts";

/** The message as the feed shows it while it travels (spec §11.1): yours, pending, with its photos. */
export function pendingMessage(input: MessageInput, date: string): ChatMessage {
  return {
    id: input.id, date, role: "user", text: input.text, photo_ids: input.photo_ids, status: "pending", error_code: null,
    cards: [], reply_to: null, sent_at: input.sent_at, created_at: input.sent_at,
  };
}

/** Puts a message into today's feed before the server has it. */
export function addPending(client: QueryClient, input: MessageInput): void {
  const view = client.getQueryData<DayView>(dayKey("today"));
  if (!view || view.messages.some((m) => m.id === input.id)) return;
  storeDay(client, { ...view, messages: [...view.messages, pendingMessage(input, view.date)] });
}

/** Takes it out again when it never reached the server. */
export function removePending(client: QueryClient, id: string): void {
  const view = client.getQueryData<DayView>(dayKey("today"));
  if (!view) return;
  storeDay(client, { ...view, messages: view.messages.filter((m) => m.id !== id) });
}

/** A Retry is on its way: show the failed message as pending again, on the day being viewed. */
export function markPending(client: QueryClient, view: DayView, id: string): void {
  storeDay(client, { ...view, messages: view.messages.map((m) => (m.id === id ? { ...m, status: "pending", error_code: null } : m)) });
}
```

In `web/src/queries.ts`, import `isLive` from `./coach/live.ts` and change the poll so it leaves streamed messages to their stream:

```ts
    // A message may still be with the coach (for instance after the app was suspended mid-send): look again.
    // One whose stream is open needs no polling; when a stream drops, the day is fetched again and the poll takes over.
    refetchInterval: (query) => (query.state.data?.messages.some((m) => m.status === "pending" && !isLive(m.id)) ? 3000 : false),
```

- [ ] **Step 4: The composer**

In `web/src/components/Composer.tsx`:

1. Imports: drop `useMutation` (keep `useQueryClient`); drop `MessageResult` from the type import; add

```tsx
import { dropLive, finishLive, firstStep, pushStep, startLive } from "../coach/live.ts";
import { addPending, removePending } from "../coach/pending.ts";
import { streamCoach } from "../coach/stream.ts";
```

2. Replace the whole `const send = useMutation({ … });` block with state:

```tsx
  // "storing": sent but not yet stored, so the composer is locked in case the message has to come back to it.
  // "working": stored and with the coach; typing is fine, sending waits for the reply (spec §11.1).
  const [phase, setPhase] = useState<"idle" | "storing" | "working">("idle");
  const [sendFailure, setSendFailure] = useState<unknown>(null);
```

3. In `onFiles`, replace `send.reset();` with `setSendFailure(null);`.

4. Replace the `canSend` line and the whole `submit` function with:

```tsx
  const canSend = phase === "idle" && !busy && !failed && (trimmed !== "" || attachments.length > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    const photoIds = attachments.map((a) => a.photoId).filter((id): id is string => id !== null);
    const key = JSON.stringify([trimmed, photoIds]);
    if (attempt.current?.key !== key) {
      attempt.current = { key, input: { id: crypto.randomUUID(), sent_at: new Date().toISOString(), text: trimmed, photo_ids: photoIds } };
    }
    const input = attempt.current.input;
    // What goes back into the composer if the message never reaches the server.
    const sent = { text, attachments };
    setSendFailure(null);
    setNotice(null);
    setText("");
    setAttachments([]);
    setPhase("storing");
    startLive(input.id, firstStep(input.photo_ids.length));
    addPending(client, input);
    let stored = false;
    try {
      const result = await streamCoach("/api/messages", input, (step) => {
        if (step.type === "stored") {
          stored = true;
          storeDay(client, step.day);
          setPhase("working");
        } else {
          pushStep(input.id, step.text);
        }
      });
      finishLive(input.id);
      storeDay(client, result.day);
      attempt.current = null;
      for (const a of sent.attachments) URL.revokeObjectURL(a.preview);
    } catch (error) {
      if (stored) {
        // The server has the message and the coach is on it: the pending poll shows the reply when it lands.
        dropLive(input.id);
        attempt.current = null;
        for (const a of sent.attachments) URL.revokeObjectURL(a.preview);
      } else {
        // It may never have arrived: put it back, so sending again carries the same id (spec §6.3).
        finishLive(input.id);
        removePending(client, input.id);
        setText(sent.text);
        setAttachments(sent.attachments);
        setSendFailure(error);
      }
      // Either way the screen may be out of step with the server: look again.
      void client.invalidateQueries({ queryKey: ["day"] });
    } finally {
      setPhase("idle");
    }
  }
```

5. In the JSX: the form's handler becomes `onSubmit={(event) => void submit(event)}`; the remove buttons get `disabled={phase === "storing"}`; the camera `<label>`'s `opacity-40` condition and the file input's `disabled` become `full || phase === "storing"`; the textarea's `readOnly={phase === "storing"}` (with the comment "Locked until the server has the message, so it can come back here intact."); the Send button always shows `<Icon name="arrow_upward" size={22} />` (the spinner goes — the feed shows the coach working); and the error paragraph becomes:

```tsx
        {sendFailure !== null && (
          <p role="alert" className="mt-1.5 px-2 text-sm text-danger">
            {sendError(sendFailure)}
          </p>
        )}
```

- [ ] **Step 5: The feed and Retry**

In `web/src/components/Feed.tsx`, import `useStep` from `../coach/live.ts`, add above `Bubble`:

```tsx
/** The coach's row while it works on a message (spec §11.1): dots, and what it is doing. Screen readers hear each step. */
function CoachWorking({ id }: { id: string }) {
  const step = useStep(id) ?? "Thinking…";
  return (
    <div role="status" className="mr-6 mt-3 flex items-center gap-2">
      <span className="raised-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent-ink">
        <Icon name="sports" size={16} />
      </span>
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" style={{ animationDelay: `${dot * 200}ms` }} />
        ))}
      </span>
      <span className="text-sm text-muted">{step}</span>
    </div>
  );
}
```

and in `Bubble`'s user branch wrap the returned `<div className="ml-10 …">…</div>` in a fragment, delete the `{message.status === "pending" && <span …>Sending…</span>}` line, and put the coach's row after the bubble:

```tsx
    return (
      <>
        <div className="ml-10 flex flex-col items-end">
          {/* …the bubble and the failed line, unchanged… */}
        </div>
        {message.status === "pending" && <CoachWorking id={message.id} />}
      </>
    );
```

In `web/src/pages/TodayPage.tsx`, import `{ dropLive, finishLive, firstStep, pushStep, startLive }` from `../coach/live.ts`, `{ markPending }` from `../coach/pending.ts` and `{ streamCoach }` from `../coach/stream.ts`, then replace the `retry` mutation's `mutationFn` with:

```tsx
    mutationFn: async (id: string) => {
      const shown = day.data;
      const photos = shown?.messages.find((m) => m.id === id)?.photo_ids.length ?? 0;
      if (shown) markPending(client, shown, id);
      startLive(id, firstStep(photos));
      let stored = false;
      try {
        const result = await streamCoach(`/api/messages/${id}/retry`, undefined, (step) => {
          if (step.type === "stored") {
            stored = true;
            storeDay(client, step.day);
          } else {
            pushStep(id, step.text);
          }
        });
        finishLive(id);
        return result;
      } catch (error) {
        if (stored) {
          dropLive(id);
        } else {
          finishLive(id);
          // Not restarted after all: show the message as it was until the fresh fetch arrives.
          if (shown) storeDay(client, shown);
        }
        throw error;
      }
    },
```

(`onSuccess` and `onError` stay as they are; `api` and `MessageResult` imports go if nothing else uses them.)

- [ ] **Step 6: Run the tests to see them pass**

Run: `npm test --workspace web && npm run typecheck && npm run lint && npm run build`
Expected: PASS — the new tests and every existing composer, feed and Today page test (a JSON answer is still accepted, so the composer tests that answer with `jsonResponse(…, 201)` behave as before).

- [ ] **Step 7: Commit**

```bash
git add web/src/coach/pending.ts web/src/queries.ts web/src/components/Composer.tsx web/src/components/Composer.photos.test.tsx web/src/components/Feed.tsx web/src/pages/TodayPage.tsx web/src/pages/TodayPage.live.test.tsx web/src/pages/TodayPage.pending.test.tsx
git commit -m "feat(web): messages appear at once, with the coach's live steps under them

Send puts the message and its photos in the feed and clears the composer,
which stays locked only until the server has the message. The coach's row
shows dots and each step; the reply replaces it. A message that never
reached the server goes back into the composer; a dropped stream hands over
to the pending poll, which now leaves streamed messages alone. Retry
streams too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The zabaione-ball home-screen icon

**Files:**
- Modify: `web/public/logo.svg`
- Regenerate: `web/public/apple-touch-icon-180x180.png`, `web/public/maskable-icon-512x512.png`, `web/public/pwa-64x64.png`, `web/public/pwa-192x192.png`, `web/public/pwa-512x512.png`, `web/public/favicon.ico`
- Modify: `README.md` (the iPhone section)

**Interfaces:**
- Consumes: `web/pwa-assets.config.ts` (unchanged: `padding: 0` for apple and maskable, base background) and its `npm run icons --workspace web` script.
- Produces: the icon set.

- [ ] **Step 1: Draw the icon**

Replace `web/public/logo.svg` with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- The zabaione ball (spec §11.4): a coupe of zabaione whose golden dome carries a tennis ball's seams,
       raised on the base colour. Drawn on a 120-unit grid around (60, 64) and scaled 4x, it stays inside
       the maskable safe zone (radius 204.8). The raise is the long-form filter librsvg renders. -->
  <defs>
    <filter id="raise" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="blur" />
      <feOffset in="blur" dx="12" dy="12" result="offsetDark" />
      <feFlood flood-color="#BAC4D2" result="colourDark" />
      <feComposite in="colourDark" in2="offsetDark" operator="in" result="shadowDark" />
      <feOffset in="blur" dx="-12" dy="-12" result="offsetLight" />
      <feFlood flood-color="#FFFFFF" result="colourLight" />
      <feComposite in="colourLight" in2="offsetLight" operator="in" result="shadowLight" />
      <feMerge>
        <feMergeNode in="shadowDark" />
        <feMergeNode in="shadowLight" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" fill="#E4E9F0" />
  <g filter="url(#raise)">
    <g transform="translate(256 256) scale(4) translate(-60 -64)">
      <ellipse cx="60" cy="101" rx="17" ry="4.5" fill="#D3DCE7" stroke="#A9B6C8" stroke-width="1.4" />
      <rect x="57.5" y="81" width="5" height="20" rx="2.5" fill="#D3DCE7" stroke="#A9B6C8" stroke-width="1.2" />
      <circle cx="60" cy="46" r="23" fill="#EDB94E" />
      <circle cx="52" cy="38" r="8" fill="#F6D47E" opacity="0.85" />
      <path d="M43 29 C53 38 53 50 46 59" fill="none" stroke="#FFF4D6" stroke-width="3.2" stroke-linecap="round" />
      <path d="M77 29 C67 38 67 50 74 59" fill="none" stroke="#FFF4D6" stroke-width="3.2" stroke-linecap="round" />
      <path d="M27 60 H93 Q89 83 60 84 Q31 83 27 60 Z" fill="#F4F7FB" stroke="#A9B6C8" stroke-width="1.5" />
      <path d="M30 62 H90 Q86 80 60 81 Q34 80 30 62 Z" fill="#D99A35" />
      <path d="M30 62 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 Z" fill="#EDB94E" />
    </g>
  </g>
</svg>
```

- [ ] **Step 2: Generate the icons and check them**

Run: `npm run icons --workspace web`
Expected: the six files listed above are rewritten; `git status` shows only them and `logo.svg` changed under `web/public/`.

Then measure the maskable icon's mark against its safe zone (sharp comes with the icon generator):

```bash
node -e '
const sharp = require(require.resolve("sharp", { paths: [require.resolve("@vite-pwa/assets-generator", { paths: ["web"] })] }));
sharp("web/public/maskable-icon-512x512.png").raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
  const base = [0xe4, 0xe9, 0xf0];
  let far = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    if (base.some((b, c) => Math.abs(data[i + c] - b) >= 12)) far = Math.max(far, Math.hypot(x - 255.5, y - 255.5));
  }
  console.log("mark reaches radius", far.toFixed(1), "of the safe zone 204.8", far <= 204.8 ? "OK" : "TOO BIG");
});'
```

Expected: `OK`. If it says `TOO BIG`, change `scale(4)` to `scale(3.8)` in `logo.svg` and generate again. Then look at `web/public/apple-touch-icon-180x180.png` and `web/public/pwa-64x64.png` with the Read tool: a golden ball with cream seams on a glass coupe, raised on the light base; at 64 px still a golden ball in a glass.

- [ ] **Step 3: Tell the iPhone owner how to see it**

In `README.md`'s iPhone section ("## On the iPhone"), add after the paragraph about adding the app to the home screen:

```markdown
The home-screen icon is the zabaione ball. iOS keeps the icon it saw when the app was added, so after an icon
change remove fitnessAI from the home screen and add it again; your data lives on the server and is not touched.
```

- [ ] **Step 4: Run the checks**

Run: `npm run build && npm test --workspace web`
Expected: PASS (the build copies the new icons; no test reads them).

- [ ] **Step 5: Commit**

```bash
git add web/public README.md
git commit -m "feat(web): the zabaione-ball home-screen icon

A coupe of zabaione whose golden dome carries a tennis ball's seams, raised
on the base colour, inside the maskable safe zone. The README says to re-add
the app to see it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Live checks and the visual preview (controller)

Done by the controller, not a subagent: it needs the owner's Anthropic key, which is used only through `node --env-file=.env` and never read or printed. Nothing here is committed except fixes for something clearly broken, each with a test.

- [ ] **Step 1: The strict grammar with 33 activities**

Run the workspace probe (`.superpowers/sdd/<this plan>/probe-strict.mjs`, rebuilt from milestone 2's: one `client.beta.messages.create` with `COACH_TOOLS` and a one-line prompt asking for nothing) with `node --env-file=.env`.
Expected: `200`. A `400 "The compiled grammar is too large"` means the enum must shrink: rule on it (for example, move the hints out of the enum's description) before going on.

- [ ] **Step 2: Local servers on a throwaway database**

Create an untracked `.claude/launch.json` with an API config (`bash <workspace>/run-api.sh`: `NODE_ENV=development DEV_AUTH_EMAIL=dev@localhost DATA_DIR=<workspace>/live node --env-file=../.env src/main.ts`, port 8080) and the web dev server (`npm run dev:web`, port 5173); start both; open the app in the browser pane at 375 × 812.

- [ ] **Step 3: Exercise every change**

- Save a test profile. Add manual food entries dated 29 September to 2 October with different totals (within, a little over and well over target), through the app or `POST /api/entries`.
- Send "had 2 eggs on toast and a flat white": the bubble appears at once, the box clears, the coach's row shows "Thinking…", then "Logging …" for at least 1.5 s, then "Writing a reply…", then the reply and its card. Through Vite's proxy the steps must arrive one by one, not all at the end.
- Send a generated photo (a canvas drawing, as in milestone 2) with no text: "Looking at your photo…" first.
- Send "did a 2 hour street photography walk around Soho carrying my camera bag", "45 minute bike ride" and "boxing class for an hour": photography, cycling and boxing badges, a plausible MET for the walk with its assumption.
- The activities card: totals, a tap opens the details, another switches, again closes, Edit opens the editor; the editor's More grid.
- The calendar: open, tints on the seeded days, the legend, Previous month, a tap opens the day, Escape and the scrim close it.
- Light and dark screenshots of Today (feed with the coach working), the activities card open, the calendar, the editor's More grid.
- The server log holds no message text and no step text (search for the foods and sports sent).

- [ ] **Step 4: Clean up**

Stop both servers; delete `.claude/launch.json` (and `.claude/` if empty) and the throwaway data folder; `git status` shows nothing new.

---

### Task 12: Publish and deploy (controller)

The owner asked for the merge and the deploy to happen without waiting for them ("merge all the change into main automatically and re-deploy the updated app").

- [ ] **Step 1: Full checks**

Run: `npm ci && npm run typecheck && npm run lint && npm test && npm run build && kubectl kustomize k8s > /dev/null`
Expected: all green.

- [ ] **Step 2: Push and open the pull request**

`git push -u origin m2.1-instant-activities-calendar`, then `gh pr create` with a body that says what changed, how it was checked (only checks actually run), and the deploy notes: migration 0002 re-files `other` exercises and a startup snapshot is taken first; the iPhone needs the app re-added for the icon. Read the checks once with the app's PR status tool.

- [ ] **Step 3: Merge once the checks for the code are green**

`gh pr merge --merge`. Branch protection is off; main's own workflow verifies again before it builds and deploys.

- [ ] **Step 4: Wait for the rollout on the cluster**

One background `kubectl --context home-cluster -n fitnessai wait deploy/fitnessai --for=jsonpath='{.spec.template.spec.containers[0].image}'=ghcr.io/yanbin-pan/fitnessai:<merge sha> --timeout=90m && kubectl --context home-cluster -n fitnessai rollout status deploy/fitnessai --timeout=15m`.

- [ ] **Step 5: Verify**

- Flux `Ready` at the new `Deploy` commit; the pod `Running` with no restarts.
- The log: listening; no errors. `/data/snapshots` has a new `startup-…` snapshot (the 0002 migration was pending), whose counts match the live data before the deploy, with its conversations stripped.
- In the pod: `GET /api/health` → 200 `{"ok":true}`; `GET /api/days?from=2026-10-01&to=2026-10-31`, `POST /api/messages` with `Accept: text/event-stream`, and `POST /api/photos` without a token → 401 with an empty body; the site's edge → 302 to Cloudflare Access.
- `git switch main && git pull --ff-only`; the merged branch is deleted locally and on GitHub.

- [ ] **Step 6: Report**

What shipped; the checks run; the decisions made along the way and why; and what the owner should do on the iPhone (force-quit and reopen; remove and re-add for the new icon; watch that the steps appear one by one — if they arrive all at once at the end, something between Cloudflare and the app is holding the stream back).

---

## Appendix: changes made during execution

(Filled in as tasks complete: what the reviews changed relative to the task text above.)

