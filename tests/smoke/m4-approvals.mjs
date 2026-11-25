// Run: node --env-file=.env tests/smoke/m4-approvals.mjs
// Needs the dev server on :3000 started with CRON_SECRET in .env, the demo seed (passwords and TOTP
// secrets in .dev-credentials.txt) and at least one approval request made in the app by sales1.
// Checks who can see approvals and notifications, the cron endpoint's protection, and one reminder
// run (with a temporary back-dated request that is removed afterwards).
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const req = createRequire(`${PROJECT}/package.json`);
const pg = req("pg");
const BASE = "http://localhost:3000";
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
  async api(path, body) {
    const res = await fetch(`${BASE}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: this.header() }, body: JSON.stringify(body) });
    this.store(res);
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async signIn(email) {
    const r = await this.api("/sign-in/email", { email, password: creds[email] });
    if (r.json?.twoFactorRedirect) return (await this.api("/two-factor/verify-totp", { code: totp(secrets[email]) })).status;
    return r.status;
  }
  async get(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: this.header() }, redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") ?? "", text: await res.text() };
  }
}

const sales1 = (await db.query(`select id from "user" where email = 'sales1@example.com'`)).rows[0];
const exec = (await db.query(`select id from "user" where email = 'exec@example.com'`)).rows[0];
const ar = (await db.query(
  `select a.id, a."quotationId", q.number from approval_request a join quotation q on q.id = a."quotationId" where a."requestedById" = $1 order by a."createdAt" desc limit 1`, [sales1.id])).rows[0];
if (!ar) throw new Error("No approval request by sales1 — make one in the app first");
const minShown = (await db.query(`select "minPriceSatang" from quotation_item where "quotationId" = $1 and "minPriceSatang" is not null limit 1`, [ar.quotationId])).rows[0];

// ── salesperson ──
const s1 = new Client();
check("sales1 signs in", (await s1.signIn("sales1@example.com")) === 200);
check("sales gets 404 on /approvals", (await s1.get("/approvals")).status === 404);
const asSales = await s1.get(`/approvals/${ar.id}`);
check("sales gets 404 on an approval page (it shows minimum prices)", asSales.status === 404);
const own = await s1.get(`/quotations/${ar.quotationId}`);
check("sales sees the approval history on their quotation", own.status === 200 && own.text.includes("ประวัติการขออนุมัติ"));
const minText = minShown ? (minShown.minPriceSatang / 100).toFixed(2) : null;
check("…without minimum prices", !minText || !own.text.includes(`>${minText}<`), minText ?? "");

// someone else's notification cannot be opened (or marked read)
const execNote = (await db.query(`select id, "readAt" from notification where "userId" = $1 order by "createdAt" desc limit 1`, [exec.id])).rows[0];
if (execNote) {
  const r = await s1.get(`/notifications/${execNote.id}/open`);
  const after = (await db.query(`select "readAt" from notification where id = $1`, [execNote.id])).rows[0];
  check("another user's notification: back to own list, not marked read", r.status === 303 && r.location.endsWith("/notifications") && String(after.readAt) === String(execNote.readAt), r.location);
}

// ── executive ──
const ex = new Client();
check("executive signs in", (await ex.signIn("exec@example.com")) === 200);
const list = await ex.get("/approvals");
check("executive sees the approvals list", list.status === 200 && list.text.includes(ar.number));
const page = await ex.get(`/approvals/${ar.id}`);
check("executive opens the request with the minimum price", page.status === 200 && (!minText || page.text.includes(minText)));

// ── admin only ──
const ad = new Client();
check("admin signs in", (await ad.signIn("admin@example.com")) === 200);
check("admin (not executive) gets 404 on /approvals", (await ad.get("/approvals")).status === 404);

// ── cron endpoint ──
const cron = (auth) => fetch(`${BASE}/api/cron/approval-reminders`, { method: "POST", headers: auth ? { authorization: auth } : {} });
check("cron without a secret: 404", (await cron(null)).status === 404);
check("cron with a wrong secret: 404", (await cron("Bearer wrong-secret-wrong-secret-wrong-secret")).status === 404);
check("cron by GET: not allowed", (await fetch(`${BASE}/api/cron/approval-reminders`)).status !== 200);

if (process.env.CRON_SECRET) {
  // a temporary pending request created 3 days ago (on a weekday or not, more than 4 business hours)
  const tempId = `smoke${crypto.randomBytes(6).toString("hex")}`;
  const busy = (await db.query(`select count(*)::int n from approval_request where "quotationId" = $1 and status = 'PENDING'`, [ar.quotationId])).rows[0].n;
  if (busy > 0) {
    check("reminder run (skipped: this quotation already has a pending request)", true);
  } else {
    await db.query(
      `insert into approval_request (id, "quotationId", revision, "requestedById", reason, status, lines, "totalSatang", "createdAt")
       values ($1, $2, 0, $3, 'smoke test', 'PENDING', '[]', 0, now() - interval '3 days')`, [tempId, ar.quotationId, sales1.id]);
    try {
      const r1 = await cron(`Bearer ${process.env.CRON_SECRET}`);
      const j1 = await r1.json();
      check("reminder run sends the overdue reminder", r1.status === 200 && j1.reminded >= 1, JSON.stringify(j1));
      const row = (await db.query(`select "remindedAt" from approval_request where id = $1`, [tempId])).rows[0];
      check("…and records when it reminded", !!row.remindedAt);
      const notes = (await db.query(`select count(*)::int n from notification where type = 'APPROVAL_REMINDER' and data->>'approvalId' = $1`, [tempId])).rows[0].n;
      check("…with a bell notice for the executive", notes >= 1);
      const j2 = await (await cron(`Bearer ${process.env.CRON_SECRET}`)).json();
      check("running again right away does not remind twice", !j2.reminded || j2.reminded === 0, JSON.stringify(j2));
    } finally {
      await db.query(`delete from notification where data->>'approvalId' = $1`, [tempId]);
      await db.query(`delete from approval_request where id = $1`, [tempId]);
    }
  }
}

// ── database invariants ──
const twoPending = (await db.query(`select "quotationId" from approval_request where status = 'PENDING' group by 1 having count(*) > 1`)).rowCount;
check("never two pending requests for one quotation", twoPending === 0);
const mismatch = (await db.query(
  `select q.number from quotation q where (q.status = 'PENDING_APPROVAL') <> exists (select 1 from approval_request a where a."quotationId" = q.id and a.status = 'PENDING')`)).rows;
check("a quotation is pending exactly when it has a pending request", mismatch.length === 0, mismatch.map((r) => r.number).join(","));
const approvedWithout = (await db.query(
  `select q.number from quotation q where q.status = 'APPROVED' and not exists (select 1 from approval_request a where a."quotationId" = q.id and a.status in ('APPROVED','COUNTERED'))`)).rows;
check("every approved quotation has an approval decision", approvedWithout.length === 0, approvedWithout.map((r) => r.number).join(","));

await db.end();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
