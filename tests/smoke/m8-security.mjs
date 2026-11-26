// Run: node --env-file=.env tests/smoke/m8-security.mjs [base URL]
// Security checks before going live, played as an attacker. Against the dev server by default
// (http://localhost:3000, demo seed, passwords and TOTP secrets in .dev-credentials.txt); pass the
// Render URL to run the anonymous checks only (no credentials are needed or sent there).
// Read-only: creates nothing, except the sign-in sessions it ends again.
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const LOCAL = /^http:\/\/localhost(:\d+)?$/.test(BASE);
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

async function raw(p, init = {}) {
  const res = await fetch(`${BASE}${p}`, { redirect: "manual", ...init });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

// ── anonymous ──
const health = await raw("/api/health");
const hj = JSON.parse(health.text || "{}");
check("health: 200 and every part ok", health.status === 200 && hj.ok && hj.db && hj.timezone && hj.storage, health.text);
check("health: says nothing beyond ok / not ok", Object.keys(hj).sort().join() === "db,ok,storage,timezone");

const login = await raw("/login");
const h = login.headers;
check("headers: no X-Powered-By", !h.get("x-powered-by"));
check("headers: nosniff, DENY framing, referrer policy", h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "DENY" && !!h.get("referrer-policy"));
check("headers: CSP blocks framing, <base> and foreign form targets", /frame-ancestors 'none'/.test(h.get("content-security-policy") ?? "") && /form-action 'self'/.test(h.get("content-security-policy") ?? ""));
if (!LOCAL) check("headers: HSTS on the live site", /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""));

for (const p of ["/", "/quotations", "/dashboard", "/reports", "/audit", "/admin/users", "/targets"]) {
  const r = await raw(p);
  check(`signed out: ${p} → /login`, r.status >= 300 && r.status < 400 && /\/login/.test(r.headers.get("location") ?? ""));
}
for (const p of ["/api/reports/quotations", "/api/reports/won-lines", "/api/reports/dormant", "/api/templates/customers", "/api/files/logo/x", "/api/files/signature/x"]) {
  const r = await raw(p);
  check(`signed out: ${p} gives nothing`, r.status === 404 || r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
for (const job of ["cron/daily", "cron/approval-reminders", "ops/ip-check"]) {
  const none = await raw(`/api/${job}`, { method: "POST" });
  const wrong = await raw(`/api/${job}`, { method: "POST", headers: { authorization: `Bearer ${"x".repeat(44)}` } });
  const get = await raw(`/api/${job}`);
  check(`${job}: no / wrong secret → 404, GET not allowed`, none.status === 404 && wrong.status === 404 && get.status >= 400);
}
for (const p of ["/.env", "/storage/", "/.dev-credentials.txt", "/api/files/logo/..%2F..%2F.env", "/_next/../.env", "/prisma/schema.prisma"]) {
  const r = await raw(p);
  check(`no private file at ${p}`, r.status !== 200 || !/DATABASE_URL|BETTER_AUTH_SECRET|datasource/.test(r.text), `HTTP ${r.status}`);
}
const forged = await raw("/api/auth/sign-in/email", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ email: "x@example.com", password: "x" }),
});
check("sign-in from another site's page is refused (CSRF)", forged.status === 403, `HTTP ${forged.status}`);
const unknown = await raw("/api/auth/sign-in/email", {
  method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: `nobody-${crypto.randomUUID()}@example.com`, password: "wrong-password-123" }),
});
check("unknown email: generic failure, no stack trace", unknown.status === 401 && !/at \w+ \(|prisma|stack/i.test(unknown.text), `HTTP ${unknown.status}`);

// ── signed in (dev server only) ──
if (LOCAL) {
  const credText = fs.readFileSync(`${PROJECT}/.dev-credentials.txt`, "utf8");
  const creds = Object.fromEntries(credText.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.trim().split("\t")));
  const secrets = Object.fromEntries([...credText.matchAll(/^# (\S+) TOTP secret: (\S+)/gm)].map((m) => [m[1], m[2]]));
  function b32(s) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(ch).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
  function totp(sec) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const hm = crypto.createHmac("sha1", b32(sec)).update(c).digest(); const o = hm[hm.length - 1] & 15; return ((hm.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, "0"); }
  class Client {
    jar = new Map();
    cookies = [];
    store(res) { for (const c of res.headers.getSetCookie?.() ?? []) { this.cookies.push(c); const [p] = c.split(";"); const i = p.indexOf("="); this.jar.set(p.slice(0, i), p.slice(i + 1)); } }
    header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
    async api(p, body) {
      const res = await fetch(`${BASE}/api/auth${p}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: this.header() }, body: JSON.stringify(body ?? {}) });
      this.store(res);
      return { status: res.status, json: await res.json().catch(() => null) };
    }
    async signIn(email) {
      const r = await this.api("/sign-in/email", { email, password: creds[email] });
      if (r.json?.twoFactorRedirect) return (await this.api("/two-factor/verify-totp", { code: totp(secrets[email]) })).status;
      return r.status;
    }
    get(p) { return raw(p, { headers: { cookie: this.header() } }); }
  }

  const admin = new Client();
  check("admin signs in", (await admin.signIn("admin@example.com")) === 200);
  const session = admin.cookies.filter((c) => /session_token=[^;]/.test(c)).at(-1) ?? "";
  check("session cookie is HttpOnly and SameSite=Lax", /HttpOnly/i.test(session) && /SameSite=Lax/i.test(session), session.replace(/=[^;]+/, "=…"));
  for (const p of ["/admin/list-users", "/admin/set-role", "/update-user", "/change-password", "/two-factor/disable"]) {
    const r = await admin.api(p, {});
    check(`even an admin cannot call ${p} over HTTP`, r.status === 403 || r.status === 404, `HTTP ${r.status}`);
  }
  const exec = new Client();
  check("exec signs in", (await exec.signIn("exec@example.com")) === 200);
  const reportsSqli = await exec.get(`/reports?owner=${encodeURIComponent("x' OR 1=1 --")}&from=${encodeURIComponent("2026-01-01'; drop table quotation;--")}`);
  check("hostile report filters are ignored, not executed", reportsSqli.status === 200, `HTTP ${reportsSqli.status}`);
  await exec.api("/sign-out");

  const sales1 = new Client();
  const s2 = await sales1.signIn("sales1@example.com");
  check("sales1 signs in", s2 === 200, `HTTP ${s2}`);
  const pg = (await import("node:module")).createRequire(`${PROJECT}/package.json`)("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const other = (await db.query(`select q.id, q.number from quotation q join "user" u on u.id = q."ownerId" where u.email = 'sales2@example.com' limit 1`)).rows[0];
  const sales2Id = (await db.query(`select id from "user" where email = 'sales2@example.com'`)).rows[0].id;
  await db.end();
  if (other) {
    for (const p of [`/quotations/${other.id}`, `/quotations/${other.id}/pdf`, `/quotations/${other.id}/edit`]) {
      const r = await sales1.get(p);
      check(`sales1 cannot open sales2's ${p.replace(other.id, "<id>")}`, r.status === 404 || (r.status >= 300 && r.status < 400 && !/\/quotations\//.test(r.headers.get("location") ?? "")), `HTTP ${r.status}`);
    }
  }
  const sig = await sales1.get(`/api/files/signature/${sales2Id}`);
  check("sales1 cannot fetch sales2's signature", sig.status === 404);
  if (other) {
    const from = new Date(Date.now() - 700 * 86_400_000).toISOString().slice(0, 10);
    const rep = await sales1.get(`/reports?owner=${sales2Id}&from=${from}`);
    check("sales1's report ignores ?owner=sales2", rep.status === 200 && !rep.text.includes(other.number), `HTTP ${rep.status}`);
  }

  await sales1.api("/sign-out");
  const after = await sales1.get("/quotations");
  check("after sign-out the old cookie no longer works", after.status >= 300 && after.status < 400);
  await admin.api("/sign-out");
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
