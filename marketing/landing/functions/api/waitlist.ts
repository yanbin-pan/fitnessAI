// POST /api/waitlist  { email, form?, heard?, utm_*?, ref?, lang?, hp?, t? }
//   Adds the email (or fills in "heard" for an email already on the list).
//   Always answers { ok: true } for a valid email, so the endpoint can't be
//   used to find out who has signed up.
// GET /api/waitlist?format=csv  with  Authorization: Bearer <EXPORT_TOKEN>
//   Downloads the list as CSV.

interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> }
interface Env { DB: { prepare(sql: string): D1Stmt }; EXPORT_TOKEN?: string }
type Ctx = { request: Request; env: Env };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEARD = new Set(["tiktok", "instagram", "friend", "search", "other"]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

function refHost(v: unknown): string | null {
  const s = clip(v, 500);
  if (!s) return null;
  try { return new URL(s).hostname.slice(0, 100) || null; } catch { return null; }
}

export async function onRequestPost({ request, env }: Ctx): Promise<Response> {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ ok: false, error: "bad_request" }, 415);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "bad_request" }, 400);

  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return json({ ok: false, error: "invalid_email" }, 400);

  // Bots: a filled hidden field, or a form sent within a second of the page
  // loading. Pretend it worked and store nothing.
  if (clip(b.hp, 200) || (typeof b.t === "number" && b.t < 1000)) return json({ ok: true });

  const heard = typeof b.heard === "string" && HEARD.has(b.heard) ? b.heard : null;
  const country = clip(request.headers.get("cf-ipcountry"), 2);
  await env.DB.prepare(
    `INSERT INTO signups (email, created_at, form, heard, utm_source, utm_medium, utm_campaign, referrer, country, lang)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(email) DO UPDATE SET heard = COALESCE(excluded.heard, signups.heard)`,
  ).bind(
    email, new Date().toISOString(), clip(b.form, 20), heard,
    clip(b.utm_source, 60), clip(b.utm_medium, 60), clip(b.utm_campaign, 60),
    refHost(b.ref), country, clip(b.lang, 20),
  ).run();
  return json({ ok: true });
}

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from running it as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const auth = request.headers.get("authorization") || "";
  if (!env.EXPORT_TOKEN || auth !== `Bearer ${env.EXPORT_TOKEN}`) return json({ ok: false }, 401);
  const cols = ["email", "created_at", "form", "heard", "utm_source", "utm_medium", "utm_campaign", "referrer", "country", "lang"];
  const { results } = await env.DB.prepare(`SELECT ${cols.join(", ")} FROM signups ORDER BY created_at`).all<Record<string, unknown>>();
  const body = [cols.join(","), ...results.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="waitlist.csv"', "cache-control": "no-store" } });
}
