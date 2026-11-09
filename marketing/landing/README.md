# Waitlist landing page

A one-page neumorphic site that reuses the app's real low-poly companions from `web/src/companions`. It's built for Cloudflare Pages on zabaione.app: the page is static, and a Pages Function at `/api/waitlist` stores sign-ups in a Cloudflare D1 database. The home cluster isn't involved.

The effects in `src/fx.tsx` are hand-made versions of these React Bits effects: BlurText, RotatingText, CountUp, TextType, SpotlightCard, Magnet, ClickSpark, ScrollReveal and DotGrid.

## Build

Run this once in this folder: `npm i --no-save esbuild react react-dom three@0.186.1 wrangler@4`. Then run `node build.mjs`. It writes:

- `dist/` for Cloudflare Pages: `index.html`, plus everything in `public/` (the privacy page and `_headers`).
- `zabaione-landing.html`, a single self-contained file for Artifact previews. Off the real domain the form says it's a preview and stores nothing.

Call wrangler as `../../node_modules/.bin/wrangler` (or `npx` from this folder's own install). Plain `npx wrangler` from inside the monorepo runs from the repo root and misses `wrangler.toml`.

## Sign-ups

`functions/api/waitlist.ts`:

- `POST /api/waitlist` with `{ email, form, utm_*, ref, lang, hp, t }` adds the email. A second call with `{ email, heard }` records the optional "How did you hear about us?" chip. A valid email always gets `{ ok: true }`, so nobody can probe who has signed up.
- Bots that fill the hidden `company` field, or submit within a second of loading, get `{ ok: true }` and nothing is stored.
- `GET /api/waitlist` with `Authorization: Bearer <EXPORT_TOKEN>` downloads the list as CSV.

Stored per sign-up: email, time, which form, the "heard" answer, UTM tags, the referring site's host only, country (from Cloudflare) and browser language. No cookies. `schema.sql` has the table.

## First deploy (once, needs the Cloudflare account)

1. `wrangler login`
2. `wrangler d1 create zabaione-waitlist`, then paste the printed `database_id` into `wrangler.toml`.
3. `wrangler d1 execute zabaione-waitlist --remote --file=schema.sql`
4. `node build.mjs && wrangler pages deploy` (creates the `zabaione-waitlist` project on first run and gives a `*.pages.dev` URL to check).
5. `wrangler pages secret put EXPORT_TOKEN` with a long random string.
6. In the Cloudflare dashboard, Pages project > Custom domains: add `zabaione.app` (and `www`). Optionally redirect `zabaione.co.uk` to it with a Redirect Rule.
7. Optional hardening: a WAF rate-limiting rule on `/api/waitlist` (for example 10 requests a minute per IP).

Download the list: `curl -H "Authorization: Bearer $TOKEN" https://zabaione.app/api/waitlist -o waitlist.csv`.

## Local test

```
wrangler d1 execute zabaione-waitlist --local --file=schema.sql
wrangler pages dev --port 8788 --d1 DB=00000000-0000-0000-0000-000000000000 --binding EXPORT_TOKEN=dev
```

The `--d1` flag points local dev at the same local database the `d1 execute --local` command created.
