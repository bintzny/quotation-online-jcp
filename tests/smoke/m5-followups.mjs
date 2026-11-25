// Run: node --env-file=.env tests/smoke/m5-followups.mjs
// Needs the dev server on :3000 started with CRON_SECRET in .env, the demo seed (passwords and TOTP
// secrets in .dev-credentials.txt) and at least one quotation of sales1 that was sent.
// Temporary quotations (copies of that one), a temporary PO file, follow-ups and a throwaway second
// salesperson are created and removed by the test. Checks the home worklist, who can see
// follow-ups and the PO file, the daily cron job (expiry and the 7-day reminder) and the
// database rules for Won / Lost.
// Note: the daily job runs over the whole development database, so any real sent quotation past
// its valid-until date also becomes EXPIRED (as it would in production). Won / Lost / follow-up
// actions themselves are exercised through the UI (headless browser run), not here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const req = createRequire(`${PROJECT}/package.json`);
const pg = req("pg");
const BASE = "http://localhost:3000";
const STORE = path.resolve(PROJECT, process.env.STORAGE_DIR || "storage");
const credText = fs.readFileSync(`${PROJECT}/.dev-credentials.txt`, "utf8");
const creds = Object.fromEntries(credText.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t")));
const secrets = Object.fromEntries([...credText.matchAll(/^# (\S+) TOTP secret: (\S+)/gm)].map((m) => [m[1], m[2]]));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

function b32(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(ch).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(sec) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac("sha1", b32(sec)).update(c).digest(); const o = h[h.length - 1] & 15; return ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, "0"); }
class Client {
  jar = new Map();
  store(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [p] = c.split(";"); const i = p.indexOf("="); this.jar.set(p.slice(0, i), p.slice(i + 1)); } }
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  async api(p, body) {
    const res = await fetch(`${BASE}/api/auth${p}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: this.header() }, body: JSON.stringify(body) });
    this.store(res);
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async signIn(email) {
    const r = await this.api("/sign-in/email", { email, password: creds[email] });
    if (r.json?.twoFactorRedirect) return (await this.api("/two-factor/verify-totp", { code: totp(secrets[email]) })).status;
    return r.status;
  }
  async get(p) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie: this.header() }, redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") ?? "", type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "", text: await res.text() };
  }
}

// Bangkok "today" as YYYY-MM-DD
const bkk = (offsetDays = 0) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

const sales1 = (await db.query(`select id, "companyId" from "user" where email = 'sales1@example.com'`)).rows[0];
const src = (await db.query(`select id from quotation where "ownerId" = $1 and "sentAt" is not null order by "createdAt" limit 1`, [sales1.id])).rows[0];
if (!src) throw new Error("No sent quotation of sales1 — send one in the app first");
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'quotation' and table_schema = 'public'`)).rows.map((r) => r.column_name);

/** A temporary copy of the sent quotation with some columns overridden. */
async function tempQuotation(over) {
  const id = `smoke${crypto.randomBytes(6).toString("hex")}`;
  const values = { id, number: `SMOKE-${crypto.randomBytes(4).toString("hex")}`, status: "SENT", revision: 0, version: 1, ...over };
  const list = cols.map((c) => `"${c}"`).join(", ");
  const sel = cols.map((c) => (c in values ? `$${Object.keys(values).indexOf(c) + 2}` : `"${c}"`)).join(", ");
  created.push(id); // before inserting, so a failure later still cleans up
  await db.query(`insert into quotation (${list}) select ${sel} from quotation where id = $1`, [src.id, ...Object.values(values)]);
  return id;
}

const created = [];
const poKey = `po/smoke-${crypto.randomBytes(6).toString("hex")}.pdf`;
const { hashPassword } = await import(pathToFileURL(req.resolve("better-auth/crypto")).href);
const otherEmail = "smoke-other-sales@example.com";
const otherId = crypto.randomUUID();
const otherPw = crypto.randomBytes(12).toString("base64url");
creds[otherEmail] = otherPw;
await db.query(`delete from "user" where email = $1`, [otherEmail]);

try {
  // ── fixtures ──
  const dueQ = await tempQuotation({ nextFollowupOn: bkk(-2), customerName: "SMOKE DUE CUSTOMER" });
  const quietQ = await tempQuotation({ sentAt: new Date(Date.now() - 9 * 86_400_000), nextFollowupOn: null, lastFollowupAt: null, staleNotifiedAt: null, validUntil: bkk(30), customerName: "SMOKE QUIET CUSTOMER" });
  const expQ = await tempQuotation({ issueDate: bkk(-31), validUntil: bkk(-1), nextFollowupOn: null, customerName: "SMOKE EXPIRING CUSTOMER" });
  const wonQ = await tempQuotation({ status: "WON", closedAt: new Date(), poNumber: "PO-SMOKE-1", poDate: bkk(0), poKey });
  fs.mkdirSync(path.join(STORE, "po"), { recursive: true });
  fs.writeFileSync(path.join(STORE, poKey), "%PDF-1.4\n% smoke test PO\n");
  const customerId = (await db.query(`select "customerId" from quotation where id = $1`, [src.id])).rows[0].customerId;
  const custOwner = (await db.query(`select "ownerId" from customer where id = $1`, [customerId])).rows[0].ownerId;
  const fuId = `smoke${crypto.randomBytes(6).toString("hex")}`;
  const secretNote = `SMOKE-NOTE-${crypto.randomBytes(4).toString("hex")}`;
  await db.query(`insert into followup (id, "customerId", "quotationId", "userId", "contactedOn", channel, detail) values ($1, $2, null, $3, $4, 'PHONE', $5)`, [fuId, customerId, sales1.id, bkk(0), secretNote]);

  // ── owner ──
  const s1 = new Client();
  check("sales1 signs in", (await s1.signIn("sales1@example.com")) === 200);
  const home = await s1.get("/");
  check("home lists the overdue follow-up", home.status === 200 && home.text.includes("SMOKE DUE CUSTOMER") && home.text.includes("เลยกำหนด 2 วัน"));
  check("home lists the quotation quiet for 7+ days", home.text.includes("SMOKE QUIET CUSTOMER"));
  check("…but not one sent recently with nothing due", !home.text.includes("SMOKE EXPIRING CUSTOMER"));
  const po = await s1.get(`/quotations/${wonQ}/po`);
  check("owner downloads the PO file (as an attachment, never rendered inline)", po.status === 200 && po.type === "application/pdf" && po.disposition.startsWith("attachment"), `${po.status} ${po.disposition}`);
  if (custOwner === sales1.id) {
    const cust = await s1.get(`/customers/${customerId}`);
    check("the customer's owner sees customer contacts", cust.status === 200 && cust.text.includes(secretNote));
  }

  // ── another salesperson ──
  await db.query(`insert into "user" (id, name, email, "emailVerified", role, "companyId", "mustChangePassword", "createdAt", "updatedAt") values ($1, 'Smoke Other Sales', $2, true, 'sales', $3, false, now(), now())`, [otherId, otherEmail, sales1.companyId]);
  await db.query(`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, 'credential', $2, $3, now(), now())`, [crypto.randomUUID(), otherId, await hashPassword(otherPw)]);
  const s2 = new Client();
  check("another salesperson signs in", (await s2.signIn(otherEmail)) === 200);
  check("…gets 404 on sales1's quotation", (await s2.get(`/quotations/${dueQ}`)).status === 404);
  check("…gets 404 on sales1's PO file", (await s2.get(`/quotations/${wonQ}/po`)).status === 404);
  const otherHome = await s2.get("/");
  check("…and their home page shows none of sales1's follow-ups", otherHome.status === 200 && !otherHome.text.includes("SMOKE DUE CUSTOMER") && !otherHome.text.includes("SMOKE QUIET CUSTOMER"));
  const otherCust = await s2.get(`/customers/${customerId}`);
  check("…and never sees sales1's customer contacts", !otherCust.text.includes(secretNote), `${otherCust.status}`);
  check("signed-out visitors get no PO file", (await new Client().get(`/quotations/${wonQ}/po`)).status !== 200);

  // ── executive ──
  const ex = new Client();
  check("executive signs in", (await ex.signIn("exec@example.com")) === 200);
  check("executive downloads the PO file", (await ex.get(`/quotations/${wonQ}/po`)).status === 200);
  const exCust = await ex.get(`/customers/${customerId}`);
  check("executive sees customer contacts", exCust.status === 200 && exCust.text.includes(secretNote));

  // ── daily cron ──
  const cron = (auth) => fetch(`${BASE}/api/cron/quotations-daily`, { method: "POST", headers: auth ? { authorization: auth } : {} });
  check("daily cron without a secret: 404", (await cron(null)).status === 404);
  check("daily cron with a wrong secret: 404", (await cron("Bearer wrong-secret-wrong-secret-wrong-secret")).status === 404);
  if (process.env.CRON_SECRET) {
    const r1 = await cron(`Bearer ${process.env.CRON_SECRET}`);
    const j1 = await r1.json();
    check("daily run expires and reminds", r1.status === 200 && j1.expired >= 1 && j1.stale >= 1, JSON.stringify(j1));
    const e = (await db.query(`select status, "expiredAt" from quotation where id = $1`, [expQ])).rows[0];
    check("…a quotation past its valid-until date is EXPIRED", e.status === "EXPIRED" && !!e.expiredAt);
    const audit = (await db.query(`select "actorId" from audit_log where "entityId" = $1 and action = 'quotation.expire'`, [expQ])).rows;
    check("…recorded in the audit log as done by the system", audit.length === 1 && audit[0].actorId === null);
    const d = (await db.query(`select status from quotation where id = $1`, [dueQ])).rows[0];
    check("…one still valid stays SENT", d.status === "SENT");
    const n1 = (await db.query(`select type, count(*)::int n from notification where "quotationId" = any($1) group by type`, [[expQ, quietQ]])).rows;
    const count = (type) => n1.find((x) => x.type === type)?.n ?? 0;
    check("…the owner gets an expiry bell and one 7-day bell", count("QUOTATION_EXPIRED") === 1 && count("FOLLOWUP_STALE") === 1, JSON.stringify(n1));
    await cron(`Bearer ${process.env.CRON_SECRET}`);
    const n2 = (await db.query(`select count(*)::int n from notification where "quotationId" = any($1)`, [[expQ, quietQ]])).rows[0].n;
    check("running again does not notify twice", n2 === 2, String(n2));
  }

  // ── database rules ──
  const rejects = async (sql, params) => { try { await db.query(sql, params); return false; } catch { return true; } };
  check("database refuses Won without a PO number", await rejects(`update quotation set status = 'WON', "closedAt" = now(), "poNumber" = null, "poDate" = now() where id = $1`, [dueQ]));
  check("database refuses Lost without a reason", await rejects(`update quotation set status = 'LOST', "closedAt" = now(), "lostReason" = null where id = $1`, [dueQ]));
  check("database refuses Lost 'other' without a note", await rejects(`update quotation set status = 'LOST', "closedAt" = now(), "lostReason" = 'OTHER', "lostNote" = ' ' where id = $1`, [dueQ]));
  check("database refuses a follow-up whose next date is before it", await rejects(
    `insert into followup (id, "customerId", "userId", "contactedOn", channel, detail, "nextDate") values ('smokebad', $1, $2, $3, 'PHONE', 'x', $4)`, [customerId, sales1.id, bkk(0), bkk(-1)]));
  const bad = (await db.query(`select number from quotation where status = 'WON' and ("poNumber" is null or "poDate" is null)`)).rows;
  check("every Won quotation has a PO number and date", bad.length === 0);
} finally {
  await db.query(`delete from notification where "quotationId" = any($1)`, [created]);
  await db.query(`delete from audit_log where "entityId" = any($1)`, [created]);
  await db.query(`delete from followup where id like 'smoke%' or "quotationId" = any($1)`, [created]);
  await db.query(`delete from quotation where id = any($1)`, [created]);
  await db.query(`delete from "user" where id = $1`, [otherId]);
  fs.rmSync(path.join(STORE, poKey), { force: true });
}

await db.end();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
