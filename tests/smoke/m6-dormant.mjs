// Run: node --env-file=.env tests/smoke/m6-dormant.mjs
// Needs the dev server on :3000 started with CRON_SECRET in .env, the demo seed (passwords and TOTP
// secrets in .dev-credentials.txt) and at least one quotation of sales1 that was sent.
// Temporary customers (owned by sales1 and sales2) and two temporary quotations are created and
// removed by the test. Checks the inactive-customer rules end to end over HTTP: the daily job's
// bells (once per inactive period), the home and inactive lists, what another salesperson sees,
// executive pages, the weekly email (development outbox), the Express template, settings access,
// bell links, and the database rules for lost customers and takeover requests.
// Note: the daily job runs over the whole development database (as in production).
// Requests, approvals, transfers, outcomes and the Express import are exercised in the browser run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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
    return { status: res.status, location: res.headers.get("location") ?? "", type: res.headers.get("content-type") ?? "", text: await res.text() };
  }
}

const bkk = (offsetDays = 0) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const tag = crypto.randomBytes(3).toString("hex");
const started = new Date();
const user = async (email) => (await db.query(`select id, email from "user" where email = $1`, [email])).rows[0];
const sales1 = await user("sales1@example.com");
const sales2 = await user("sales2@example.com");
const src = (await db.query(`select id from quotation where "ownerId" = $1 and "sentAt" is not null order by "createdAt" limit 1`, [sales1.id])).rows[0];
if (!src) throw new Error("No sent quotation of sales1 — send one in the app first");
const qcols = (await db.query(`select column_name from information_schema.columns where table_name = 'quotation' and table_schema = 'public'`)).rows.map((r) => r.column_name);

const customers = [];
const quotations = [];
async function tempCustomer(name, ownerId, o = {}) {
  const id = `smoke${crypto.randomBytes(6).toString("hex")}`;
  customers.push(id);
  await db.query(
    `insert into customer (id, type, name, address, status, "ownerId", "lastPurchaseDate", "createdAt", "updatedAt", "dormantNotifiedAt", "dormantSnoozedUntil")
     values ($1, 'INDIVIDUAL', $2, 'smoke address', $3, $4, $5, $6, now(), null, $7)`,
    [id, `${name} ${tag}`, o.status ?? "ACTIVE", ownerId, o.lastPurchase ?? null, o.createdAt ?? new Date(), o.snoozedUntil ?? null],
  );
  return id;
}
async function tempQuotation(over) {
  const id = `smoke${crypto.randomBytes(6).toString("hex")}`;
  const values = { id, number: `SMOKE-${crypto.randomBytes(4).toString("hex")}`, revision: 0, version: 1, ...over };
  const list = qcols.map((c) => `"${c}"`).join(", ");
  const sel = qcols.map((c) => (c in values ? `$${Object.keys(values).indexOf(c) + 2}` : `"${c}"`)).join(", ");
  quotations.push(id);
  await db.query(`insert into quotation (${list}) select ${sel} from quotation where id = $1`, [src.id, ...Object.values(values)]);
  return id;
}
const bells = async (userId, customerId) => Number((await db.query(`select count(*) from notification where "userId" = $1 and "customerId" = $2 and type = 'CUSTOMER_DORMANT'`, [userId, customerId])).rows[0].count);
const cron = (q = "") => fetch(`${BASE}/api/cron/daily${q}`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

try {
  // ── fixtures ──
  const dormantA = await tempCustomer("SMOKE DORMANT A", sales1.id, { lastPurchase: bkk(-220) });
  const neverOld = await tempCustomer("SMOKE NEVER BOUGHT", sales1.id, { createdAt: new Date(Date.now() - 200 * 86_400_000) });
  const recent = await tempCustomer("SMOKE RECENT", sales1.id, { lastPurchase: bkk(-30) });
  const edge = await tempCustomer("SMOKE SIX MONTHS", sales1.id, { lastPurchase: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10).replace(/^(\d{4})-(\d{2})/, (_, y, m) => { const d = new Date(Date.UTC(+y, +m - 1 - 6, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }) });
  const snoozed = await tempCustomer("SMOKE SNOOZED", sales1.id, { lastPurchase: bkk(-300), snoozedUntil: bkk(10) });
  const otherDormant = await tempCustomer("SMOKE OTHER DORMANT", sales2.id, { lastPurchase: bkk(-250) });
  const otherRecent = await tempCustomer("SMOKE OTHER RECENT", sales2.id, { lastPurchase: bkk(-10) });
  await tempQuotation({ customerId: otherDormant, ownerId: sales2.id, createdById: sales2.id, status: "SENT", customerName: `SMOKE OTHER DORMANT ${tag}` });

  // ── daily job ──
  check("cron without the secret is 404", (await fetch(`${BASE}/api/cron/daily`, { method: "POST" })).status === 404);
  const r1 = await cron();
  const j1 = await r1.json().catch(() => ({}));
  check("cron runs both jobs", r1.status === 200 && "expired" in j1 && "dormantNotified" in j1, JSON.stringify(j1));
  check("bell for a customer with no purchase for more than 6 months", (await bells(sales1.id, dormantA)) === 1);
  check("bell for an old customer that never bought (counted from the day added)", (await bells(sales1.id, neverOld)) === 1);
  check("no bell for a recent buyer", (await bells(sales1.id, recent)) === 0);
  check("no bell at exactly 6 months (more than 6 is needed)", (await bells(sales1.id, edge)) === 0);
  check("no bell while the owner's snooze lasts", (await bells(sales1.id, snoozed)) === 0);
  check("the other salesperson's customer goes to them", (await bells(sales2.id, otherDormant)) === 1 && (await bells(sales1.id, otherDormant)) === 0);
  await cron();
  check("a second run does not ring again", (await bells(sales1.id, dormantA)) === 1 && (await bells(sales2.id, otherDormant)) === 1);

  // ── salesperson pages ──
  const s1 = new Client();
  check("sales1 signs in", (await s1.signIn("sales1@example.com")) === 200);
  const home = await s1.get("/");
  check("home lists inactive customers", home.status === 200 && home.text.includes(`SMOKE DORMANT A ${tag}`) && home.text.includes(`SMOKE NEVER BOUGHT ${tag}`));
  check("…not recent, six-month or snoozed ones", !home.text.includes(`SMOKE RECENT ${tag}`) && !home.text.includes(`SMOKE SIX MONTHS ${tag}`) && !home.text.includes(`SMOKE SNOOZED ${tag}`));
  check("…and never another salesperson's", !home.text.includes(`SMOKE OTHER DORMANT ${tag}`));
  const list = await s1.get("/customers/dormant");
  check("inactive page lists own (snoozed separately), not others'", list.status === 200 && list.text.includes(`SMOKE DORMANT A ${tag}`) && list.text.includes(`SMOKE SNOOZED ${tag}`) && !list.text.includes(`SMOKE OTHER DORMANT ${tag}`));
  const other = await s1.get(`/customers/${otherDormant}`);
  check("another's inactive customer: notice + request button, no details", other.status === 200 && other.text.includes("ไม่มีการซื้อเกิน 6 เดือน") && other.text.includes("ขอรับดูแลลูกค้า</button>") && !other.text.includes("smoke address"));
  const otherR = await s1.get(`/customers/${otherRecent}`);
  check("another's recent customer: no request button", otherR.status === 200 && !otherR.text.includes("ขอรับดูแลลูกค้า</button>"));
  const own = await s1.get(`/customers/${dormantA}`);
  check("own inactive customer: banner and the outcome choice", own.status === 200 && own.text.includes("ไม่มีการซื้อเกิน 6 เดือน") && own.text.includes('value="STILL_CUSTOMER"'));
  check("salesperson sees only their own requests page", (await s1.get("/customers/transfers")).status === 200);
  check("salesperson cannot open settings", (await s1.get("/admin/settings")).status === 404);
  check("salesperson cannot download the Express template", (await s1.get("/api/templates/last-sales")).status === 404);
  const bell = (await db.query(`select id from notification where "userId" = $1 and "customerId" = $2 and type = 'CUSTOMER_DORMANT'`, [sales1.id, dormantA])).rows[0];
  const open = await s1.get(`/notifications/${bell.id}/open`);
  check("the bell opens the customer", open.status === 303 && open.location.endsWith(`/customers/${dormantA}`), open.location);

  // ── executive / admin ──
  const ex = new Client();
  check("executive signs in", (await ex.signIn("exec@example.com")) === 200);
  const exList = await ex.get("/customers/dormant");
  check("executive overview lists everyone's inactive customers", exList.status === 200 && exList.text.includes(`SMOKE DORMANT A ${tag}`) && exList.text.includes(`SMOKE OTHER DORMANT ${tag}`) && exList.text.includes("แยกตามพนักงานขาย"));
  check("…with the transfer control", exList.text.includes('id="transfer-to"'));
  check("executive opens takeover requests", (await ex.get("/customers/transfers")).status === 200);
  const ad = new Client();
  check("admin signs in", (await ad.signIn("admin@example.com")) === 200);
  check("admin opens settings", (await ad.get("/admin/settings")).status === 200);
  const tpl = await ad.get("/api/templates/last-sales");
  check("admin downloads the Express last-sale template", tpl.status === 200 && tpl.type.includes("spreadsheetml"));

  // ── weekly email (development outbox) ──
  const outbox = path.join(STORE, "outbox");
  const before = new Set(fs.existsSync(outbox) ? fs.readdirSync(outbox) : []);
  await db.query(`delete from mail_digest where "userId" = $1 and kind = 'dormant-weekly'`, [sales1.id]);
  const d1 = await (await cron("?digest=now")).json();
  const mails = (fs.existsSync(outbox) ? fs.readdirSync(outbox) : []).filter((f) => !before.has(f) && f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(outbox, f), "utf8")))
    .filter((m) => [].concat(m.to).includes(sales1.email) && m.subject.includes("สรุปลูกค้าที่หายไป"));
  check("weekly email to the owner lists their inactive customers", d1.digests >= 1 && mails.length === 1 && mails[0].text.includes(`SMOKE DORMANT A ${tag}`) && !mails[0].text.includes(`SMOKE OTHER DORMANT ${tag}`), `digests=${d1.digests}`);
  const d2 = await (await cron("?digest=now")).json();
  const again = (fs.existsSync(outbox) ? fs.readdirSync(outbox) : []).filter((f) => !before.has(f) && f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(outbox, f), "utf8")))
    .filter((m) => [].concat(m.to).includes(sales1.email) && m.subject.includes("สรุปลูกค้าที่หายไป"));
  check("only one weekly email per week", again.length === 1, `second run digests=${d2.digests}`);

  // ── database rules ──
  const fails = async (sql, params) => { try { await db.query(sql, params); return false; } catch { return true; } };
  check("a lost customer needs a reason", await fails(`update customer set status = 'LOST' where id = $1`, [recent]));
  const reqId = `smoke${crypto.randomBytes(6).toString("hex")}`;
  await db.query(`insert into customer_transfer_request (id, "customerId", "requesterId", reason) values ($1, $2, $3, 'smoke')`, [reqId, otherDormant, sales1.id]);
  check("one open request per salesperson and customer", await fails(`insert into customer_transfer_request (id, "customerId", "requesterId", reason) values ($1, $2, $3, 'smoke 2')`, [`${reqId}b`, otherDormant, sales1.id]));
  check("a decided request records who decided", await fails(`update customer_transfer_request set status = 'APPROVED' where id = $1`, [reqId]));
  check("a request needs a reason", await fails(`insert into customer_transfer_request (id, "customerId", "requesterId", reason) values ($1, $2, $3, '  ')`, [`${reqId}c`, otherDormant, sales2.id]));
} finally {
  await db.query(`delete from notification where "customerId" = any($1)`, [customers]);
  await db.query(`delete from quotation where id = any($1)`, [quotations]);
  await db.query(`delete from audit_log where "entityId" = any($1)`, [[...customers, ...quotations]]);
  await db.query(`delete from customer where id = any($1)`, [customers]);
  await db.query(`delete from mail_digest where kind = 'dormant-weekly' and "sentAt" >= $1`, [started]);
  await db.end();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
