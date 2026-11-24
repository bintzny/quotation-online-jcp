// Run: node --env-file=.env tests/smoke/m0-auth.mjs   (dev server on :3000, fresh npm run db:seed:demo)
// M0 smoke + attacker tests against the running dev server (http://localhost:3000).
// Expects a freshly seeded demo DB (npm run db:seed:demo). Writes changed passwords back
// to .dev-credentials.txt.
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const pg = createRequire(`${PROJECT}/package.json`)("pg");
const { hashPassword } = await import(pathToFileURL(`${PROJECT}/node_modules/better-auth/dist/crypto/index.mjs`).href);
const BASE = "http://localhost:3000";
const CRED = `${PROJECT}/.dev-credentials.txt`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const creds = Object.fromEntries(
  fs.readFileSync(CRED, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t")).map(([e, p]) => [e, p]),
);
const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
}

class Client {
  constructor() { this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/max-age=0/i.test(c) || v === "") this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }
  async api(path, body, method = "POST") {
    const res = await fetch(`${BASE}/api/auth${path}`, {
      method,
      headers: { "content-type": "application/json", origin: BASE, cookie: this.cookieHeader() },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      redirect: "manual",
    });
    this.store(res);
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }
  async page(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: this.cookieHeader() }, redirect: "manual" });
    this.store(res);
    return { status: res.status, location: res.headers.get("location"), text: res.status === 200 || res.status === 404 ? await res.text() : "" };
  }
}

function base32Decode(s) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
const setPw = {};

/** Finish the forced password change the way the app's server action ends up (password set, flag cleared). */
async function completePasswordChange(email) {
  const next = crypto.randomBytes(12).toString("base64url");
  const u = (await db.query(`select id from "user" where email=$1`, [email])).rows[0];
  await db.query(`update account set password=$1 where "userId"=$2 and "providerId"='credential'`, [await hashPassword(next), u.id]);
  await db.query(`update "user" set "mustChangePassword"=false where id=$1`, [u.id]);
  setPw[email] = next;
  return next;
}

console.log("… waiting 61s so earlier runs do not count against the per-IP rate limit");
await new Promise((r) => setTimeout(r, 61_000));

// ── 1. Lockout, sequential ──
{
  const email = "sales2@example.com";
  const c = new Client();
  let last;
  for (let i = 0; i < 5; i++) last = await c.api("/sign-in/email", { email, password: "wrong-password-x" });
  check("5th wrong password returns 401", last.status === 401, `status ${last.status}`);
  const locked = await c.api("/sign-in/email", { email, password: creds[email] });
  check("correct password refused while locked", locked.status === 403 && locked.json?.code === "ACCOUNT_LOCKED", JSON.stringify(locked.json));
  const r = (await db.query(`select extract(epoch from ("lockedUntil" - now())) secs from "user" where email=$1`, [email])).rows[0];
  check("locked for ~15 minutes", Number(r.secs) > 14 * 60 && Number(r.secs) <= 15 * 60, `${r.secs}s`);
  await db.query(`update "user" set "lockedUntil"=null, "failedLoginCount"=0 where email=$1`, [email]);
}

// ── 2. Lockout, 25 concurrent requests (race) ──
{
  const email = "sales2@example.com";
  const reqs = Array.from({ length: 25 }, (_, i) => new Client().api("/sign-in/email", { email, password: `wrong-${i}-xxxxx` }));
  const res = await Promise.all(reqs);
  const checked = res.filter((r) => r.status === 401).length;
  const refused = res.filter((r) => r.status === 403).length;
  check("concurrent attack: at most 5 passwords actually checked", checked <= 5, `401=${checked}, 403=${refused}, other=${25 - checked - refused}`);
  const lockedRow = (await db.query(`select "lockedUntil" is not null and "lockedUntil" > now() as locked from "user" where email=$1`, [email])).rows[0];
  check("account locked after the concurrent attack", lockedRow.locked === true);
  // The per-IP sign-in limit (30/min) is now used up by this script; wait for the window to pass.
  console.log("… waiting 61s for the per-IP rate-limit window");
  await new Promise((r) => setTimeout(r, 61_000));
  await db.query(`update "user" set "lockedUntil"=null, "failedLoginCount"=0 where email=$1`, [email]);
  const ok = await new Client().api("/sign-in/email", { email, password: creds[email] });
  check("correct password works once unlocked", ok.status === 200, `${ok.status}`);
  const cnt = (await db.query(`select "failedLoginCount" from "user" where email=$1`, [email])).rows[0];
  check("successful sign-in resets the counter", cnt.failedLoginCount === 0, `${cnt.failedLoginCount}`);
}

// ── 3. Admin who has not finished onboarding cannot use admin endpoints directly ──
{
  const c = new Client();
  const s = await c.api("/sign-in/email", { email: "admin@example.com", password: creds["admin@example.com"] });
  check("admin (temp password, no 2FA) can sign in", s.status === 200, `${s.status}`);
  const list = await c.api("/admin/list-users", null, "GET");
  check("…but GET /admin/list-users is blocked", list.status === 403 && list.json?.code === "ENDPOINT_NOT_AVAILABLE", `${list.status} ${JSON.stringify(list.json)}`);
  const create = await c.api("/admin/create-user", { email: "evil@example.com", password: "abcdefghijkl", name: "x", role: "admin" });
  check("…and POST /admin/create-user is blocked", create.status === 403, `${create.status}`);
  const evil = (await db.query(`select count(*)::int n from "user" where email='evil@example.com'`)).rows[0].n;
  check("no user was created", evil === 0);
  const page = await c.page("/admin/users");
  check("admin pages redirect to onboarding", page.status === 307 && page.location?.includes("/change-password"), `${page.status} ${page.location}`);
  const cp = await c.api("/change-password", { currentPassword: creds["admin@example.com"], newPassword: "abcdefghijkl", revokeOtherSessions: true });
  check("password change over HTTP is blocked (must use the app form)", cp.status === 403, `${cp.status}`);
}

// ── 4. Sales: no admin access, cannot rename self ──
{
  const email = "sales1@example.com";
  const pw = await completePasswordChange(email);
  const c = new Client();
  const s = await c.api("/sign-in/email", { email, password: pw });
  check("sales1 signs in", s.status === 200, `${s.status}`);
  check("sales1 reaches home (no 2FA needed)", (await c.page("/")).status === 200);
  const admin = await c.page("/admin/users");
  check("sales1 gets the translated 404 on /admin/users", admin.status === 404 && admin.text.includes("ไม่พบหน้าที่ต้องการ"), `${admin.status}`);
  const rename = await c.api("/update-user", { name: "พนักงานขาย สอง" });
  const nameNow = (await db.query(`select name from "user" where email=$1`, [email])).rows[0].name;
  check("sales1 cannot rename self via update-user", rename.status === 403 && nameNow === "พนักงานขาย หนึ่ง", `${rename.status}, name=${nameNow}`);
  const dis = await c.api("/two-factor/disable", { password: pw });
  check("2FA disable endpoint is blocked", dis.status === 403, `${dis.status}`);
}

// ── 5. Executive: forced 2FA, sign-in requires TOTP ──
let execSecret;
{
  const email = "exec@example.com";
  const pw = await completePasswordChange(email);
  const c = new Client();
  await c.api("/sign-in/email", { email, password: pw });
  const home = await c.page("/");
  check("executive without 2FA is sent to /setup-2fa", home.status === 307 && home.location?.includes("/setup-2fa"), `${home.status} ${home.location}`);
  const en = await c.api("/two-factor/enable", { password: pw });
  check("2FA enable returns QR data", en.status === 200 && !!en.json?.totpURI, `${en.status}`);
  execSecret = new URL(en.json.totpURI).searchParams.get("secret");
  const ok = await c.api("/two-factor/verify-totp", { code: totp(execSecret) });
  check("correct TOTP turns 2FA on", ok.status === 200, `${ok.status}`);
  check("executive reaches home", (await c.page("/")).status === 200);
  const c2 = new Client();
  const s = await c2.api("/sign-in/email", { email, password: pw });
  check("next sign-in asks for the second factor", s.json?.twoFactorRedirect === true, JSON.stringify(s.json));
  const before = await c2.page("/");
  check("no app access before the code", before.status === 307, `${before.status}`);
  await c2.api("/two-factor/verify-totp", { code: totp(execSecret) });
  check("app reachable after the code", (await c2.page("/")).status === 200);
}

// ── 6. Translated 404 for unknown URLs ──
{
  const r = await new Client().page("/login/does-not-exist");
  check("unknown URL shows the Thai 404 page", r.status === 404 && r.text.includes("ไม่พบหน้าที่ต้องการ"), `${r.status}`);
}

const lines = fs.readFileSync(CRED, "utf8").split("\n").map((l) => {
  const [e, , role] = l.split("\t");
  return setPw[e] ? `${e}\t${setPw[e]}\t${role}` : l;
});
fs.writeFileSync(CRED, lines.join("\n"));
if (execSecret) fs.appendFileSync(CRED, `# exec@example.com TOTP secret: ${execSecret}\n`);

await db.end();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
