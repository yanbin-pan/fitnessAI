-- Waitlist sign-ups for zabaione.app (Cloudflare D1).
-- Apply with: npx wrangler d1 execute zabaione-waitlist --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS signups (
  email      TEXT PRIMARY KEY,           -- lower-cased, trimmed
  created_at TEXT NOT NULL,              -- ISO time of the first sign-up
  form       TEXT,                       -- which form: top or bottom
  heard      TEXT,                       -- optional "how did you hear" answer
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
  referrer   TEXT,                       -- host only, never the full URL
  country    TEXT,                       -- two-letter code from Cloudflare
  lang       TEXT                        -- browser language
);
CREATE INDEX IF NOT EXISTS signups_created ON signups(created_at);
