// Run: node --env-file=.env tests/smoke/m2-quotations.mjs
// Needs the dev server on :3000, the demo seed with passwords in .dev-credentials.txt (sales1,
// exec and admin with their TOTP secrets), and at least one quotation created by sales1 through the
// app (a draft is enough). A throwaway second salesperson is created and deleted by the test.
// Checks who can read quotations, that minimum prices do not reach sales users, numbering under
// concurrency, and that stored totals add up.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const pg = createRequire(`${PROJECT}/package.json`)("pg");
const BASE = "http://localhost:3000";
const credText = fs.readFileSync(`${PROJECT}/.dev-credentials.txt`, "utf8");
// later lines win (passwords may have been reset)
const creds = Object.fromEntries(credText.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t")).map(([e, p]) => [e, p]));
const secrets = Object.fromEntries([...credText.matchAll(/^# (\S+) TOTP secret: (\S+)/gm)].map((m) => [m[1], m[2]]));

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

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

class Client {
  jar = new Map();
  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  async api(path, body) {
    const res = await fetch(`${BASE}/api/auth${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: this.header() }, body: JSON.stringify(body),
    });
    this.store(res);
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async signIn(email) {
    const r = await this.api("/sign-in/email", { email, password: creds[email] });
    if (r.json?.twoFactorRedirect) return (await this.api("/two-factor/verify-totp", { code: totp(secrets[email]) })).status;
    return r.status;
  }
  async page(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: this.header() }, redirect: "manual" });
    return { status: res.status, text: await res.text() };
  }
}

const sales1 = (await db.query(`select id from "user" where email = 'sales1@example.com'`)).rows[0];
const q = (await db.query(
  `select q.id, q.number, q.status from quotation q where q."ownerId" = $1 order by q."createdAt" limit 1`, [sales1.id],
)).rows[0];
const draft = (await db.query(`select id from quotation where "ownerId" = $1 and status = 'DRAFT' limit 1`, [sales1.id])).rows[0];
if (!q) throw new Error("No quotation by sales1 — create one in the app first");
const minPrices = (await db.query(`select distinct "minPriceSatang" from quotation_item where "quotationId" = $1 and "minPriceSatang" is not null`, [q.id]))
  .rows.map((r) => (r.minPriceSatang / 100).toFixed(2));

// ── sales1: own quotation ──
const s1 = new Client();
check("sales1 signs in", (await s1.signIn("sales1@example.com")) === 200);
const list1 = await s1.page("/quotations");
check("sales1 sees own quotation in the list", list1.status === 200 && list1.text.includes(q.number));
const detail1 = await s1.page(`/quotations/${q.id}`);
check("sales1 opens own quotation", detail1.status === 200);
check("detail page: no minimum price field or values for sales",
  !detail1.text.includes("minPriceSatang") && !minPrices.some((v) => detail1.text.includes(`>${v}<`)), minPrices.join(","));
if (draft) {
  const edit1 = await s1.page(`/quotations/${draft.id}/edit`);
  check("editor page: no minimum price in props", edit1.status === 200 && !edit1.text.includes("minPriceSatang"));
}

// ── another salesperson (a throwaway account, removed at the end) must not see them ──
const { hashPassword } = await import(pathToFileURL(createRequire(`${PROJECT}/package.json`).resolve("better-auth/crypto")).href);
const otherEmail = "smoke-other-sales@example.com";
const otherPw = crypto.randomBytes(12).toString("base64url");
const otherId = crypto.randomUUID();
const aaa = (await db.query(`select "companyId" from "user" where id = $1`, [sales1.id])).rows[0];
await db.query(`delete from "user" where email = $1`, [otherEmail]);
await db.query(
  `insert into "user" (id, name, email, "emailVerified", role, "companyId", "mustChangePassword", "createdAt", "updatedAt")
   values ($1, 'Smoke Other Sales', $2, true, 'sales', $3, false, now(), now())`, [otherId, otherEmail, aaa.companyId]);
await db.query(
  `insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, 'credential', $2, $3, now(), now())`,
  [crypto.randomUUID(), otherId, await hashPassword(otherPw)]);
creds[otherEmail] = otherPw;
try {
  const s2 = new Client();
  check("another salesperson signs in", (await s2.signIn(otherEmail)) === 200);
  const list2 = await s2.page("/quotations");
  check("their list does not show sales1's quotation", list2.status === 200 && !list2.text.includes(q.number), `${list2.status}`);
  for (const p of [`/quotations/${q.id}`, `/quotations/${q.id}/edit`]) {
    const r = await s2.page(p);
    check(`they get 404 on ${p.replace(q.id, "<id>")}`, r.status === 404, `${r.status}`);
    check(`… and the number is not in the response`, !r.text.includes(q.number));
  }
  const search = await s2.page(`/quotations?q=${encodeURIComponent(q.number)}`);
  // the search box echoes the typed number, so look for the result link instead
  check("searching sales1's number finds nothing", search.status === 200 && !search.text.includes(`/quotations/${q.id}`));
} finally {
  await db.query(`delete from "user" where id = $1`, [otherId]); // cascades to sessions and account
}

// ── executive: sees everything, including minimum prices ──
const ex = new Client();
check("executive signs in with TOTP", (await ex.signIn("exec@example.com")) === 200);
const listE = await ex.page("/quotations");
check("executive sees sales1's quotation", listE.status === 200 && listE.text.includes(q.number));
const detailE = await ex.page(`/quotations/${q.id}`);
check("executive detail shows minimum prices", detailE.status === 200 && minPrices.every((v) => detailE.text.includes(v)));
const newE = await ex.page("/quotations/new");
check("executive without the sales role cannot create quotations", newE.status === 404, `${newE.status}`);

// ── admin only: no access to quotations ──
const ad = new Client();
check("admin signs in with TOTP", (await ad.signIn("admin@example.com")) === 200);
for (const p of ["/quotations", `/quotations/${q.id}`]) {
  const r = await ad.page(p);
  check(`admin gets 404 on ${p.replace(q.id, "<id>")}`, r.status === 404, `${r.status}`);
}

// ── numbering: the upsert used by the app hands out unique numbers under concurrency ──
const company = (await db.query(`select id from company order by code limit 1`)).rows[0];
const TEST_YM = "9901";
await db.query(`delete from doc_sequence where "companyId" = $1 and "yearMonth" = $2`, [company.id, TEST_YM]);
const conns = await Promise.all(Array.from({ length: 10 }, async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}));
const got = (await Promise.all(Array.from({ length: 40 }, (_, i) => conns[i % conns.length].query(
  `INSERT INTO doc_sequence ("companyId", "yearMonth", "lastNumber") VALUES ($1, $2, 1)
   ON CONFLICT ("companyId", "yearMonth") DO UPDATE SET "lastNumber" = doc_sequence."lastNumber" + 1 RETURNING "lastNumber"`,
  [company.id, TEST_YM],
)))).map((r) => r.rows[0].lastNumber).sort((a, b) => a - b);
check("40 concurrent numbers are 1..40 with no duplicates", got.join(",") === Array.from({ length: 40 }, (_, i) => i + 1).join(","));
await db.query(`delete from doc_sequence where "companyId" = $1 and "yearMonth" = $2`, [company.id, TEST_YM]);
await Promise.all(conns.map((c) => c.end()));

// ── stored figures add up ──
const bad = await db.query(`
  select q.number from quotation q
  left join (select "quotationId", sum("netSatang") net, sum("billShareSatang") share from quotation_item group by 1) i on i."quotationId" = q.id
  where q."subtotalSatang" <> coalesce(i.net, 0) or q."billDiscountSatang" <> coalesce(i.share, 0)`);
check("every quotation: subtotal = Σ line amounts and bill discount = Σ line shares", bad.rowCount === 0, bad.rows.map((r) => r.number).join(","));
const seq = await db.query(`
  select q."companyId", substring(q.number from '-(\\d{4})-\\d+$') ym, count(*)::int n, max(s."lastNumber") last
  from quotation q left join doc_sequence s on s."companyId" = q."companyId" and s."yearMonth" = substring(q.number from '-(\\d{4})-\\d+$')
  group by 1, 2`);
check("the sequence is never behind the numbers issued", seq.rows.every((r) => r.last >= r.n));
const claimed = await db.query(`select count(*)::int n from customer_owner_history where reason = 'QUOTE_CLAIM' and "toUserId" = $1`, [sales1.id]);
const unownedQuoted = await db.query(`select count(*)::int n from quotation q join customer c on c.id = q."customerId" where c."ownerId" is null`);
check("no quotation for a customer without an owner (first quote claims it)", unownedQuoted.rows[0].n === 0, `claims by sales1: ${claimed.rows[0].n}`);

await db.end();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
