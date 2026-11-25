// Run: node --env-file=.env tests/smoke/m3-documents.mjs
// Needs the dev server on :3000, the demo seed with passwords/TOTP secrets in .dev-credentials.txt,
// and at least one quotation of sales1 that was sent (so a stored PDF exists). A throwaway second
// salesperson is created and deleted by the test.
// Checks who can download quotation PDFs and private images, and that storage is not public.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "", buf };
  }
}
const isPdf = (r) => r.status === 200 && r.type === "application/pdf" && r.buf.subarray(0, 5).toString() === "%PDF-";

const sales1 = (await db.query(`select id, "signatureKey" from "user" where email = 'sales1@example.com'`)).rows[0];
const sent = (await db.query(
  `select q.id, q.number, r.revision, r."pdfKey" from quotation q join quotation_revision r on r."quotationId" = q.id
   where q."ownerId" = $1 and r."pdfKey" is not null order by r."sentAt" desc limit 1`, [sales1.id])).rows[0];
if (!sent) throw new Error("No sent quotation with a stored PDF — send one from the app first");
const logo = (await db.query(`select id from company where "logoKey" is not null limit 1`)).rows[0];
const paths = [`/quotations/${sent.id}/pdf`, `/quotations/${sent.id}/revisions/${sent.revision}/pdf`];

// ── nobody signed in ──
const anon = new Client();
for (const p of [...paths, `/api/files/signature/${sales1.id}`, ...(logo ? [`/api/files/logo/${logo.id}`] : [])]) {
  const r = await anon.get(p);
  check(`signed out: no file at ${p.replace(sent.id, "<id>").replace(sales1.id, "<user>")}`, r.status !== 200 && !r.buf.subarray(0, 5).toString().startsWith("%PDF"), `${r.status}`);
}

// ── storage is never served directly ──
for (const p of [`/storage/${sent.pdfKey}`, `/${sent.pdfKey}`, `/quotations/${sent.id}/revisions/..%2F..%2F.env/pdf`]) {
  const r = await anon.get(p);
  check(`not public: ${p.replace(sent.id, "<id>").slice(0, 60)}`, r.status !== 200 || r.type !== "application/pdf", `${r.status}`);
}

// ── owner ──
const s1 = new Client();
check("sales1 signs in", (await s1.signIn("sales1@example.com")) === 200);
const own = await s1.get(paths[0]);
check("owner downloads the PDF (inline, safe file name)", isPdf(own) && /^inline; filename="QT-[A-Z]+-\d{4}-\d{4}(-R\d+)?\.pdf"$/.test(own.disposition), own.disposition);
const stored = fs.readFileSync(`${PROJECT}/storage/${sent.pdfKey}`);
check("a sent quotation serves exactly the stored PDF", own.buf.equals(stored));
const rev = await s1.get(paths[1]);
check("owner downloads the revision PDF", isPdf(rev) && rev.buf.equals(stored));
const dl = await s1.get(`${paths[0]}?download=1`);
check("?download=1 asks the browser to save", dl.disposition.startsWith("attachment;"));
check("revision that does not exist: 404", (await s1.get(`/quotations/${sent.id}/revisions/999/pdf`)).status === 404);
check("bad revision number: 404", (await s1.get(`/quotations/${sent.id}/revisions/-1/pdf`)).status === 404);
if (sales1.signatureKey) {
  const sig = await s1.get(`/api/files/signature/${sales1.id}`);
  check("own signature preview", sig.status === 200 && /^image\/(png|jpeg)$/.test(sig.type));
}

// ── another salesperson ──
const { hashPassword } = await import(pathToFileURL(req.resolve("better-auth/crypto")).href);
const otherEmail = "smoke-other-sales@example.com";
const otherId = crypto.randomUUID();
const otherPw = crypto.randomBytes(12).toString("base64url");
const companyId = (await db.query(`select "companyId" from "user" where id = $1`, [sales1.id])).rows[0].companyId;
await db.query(`delete from "user" where email = $1`, [otherEmail]);
await db.query(`insert into "user" (id, name, email, "emailVerified", role, "companyId", "mustChangePassword", "createdAt", "updatedAt") values ($1, 'Smoke Other Sales', $2, true, 'sales', $3, false, now(), now())`, [otherId, otherEmail, companyId]);
await db.query(`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, 'credential', $2, $3, now(), now())`, [crypto.randomUUID(), otherId, await hashPassword(otherPw)]);
creds[otherEmail] = otherPw;
try {
  const s2 = new Client();
  check("another salesperson signs in", (await s2.signIn(otherEmail)) === 200);
  for (const p of paths) {
    const r = await s2.get(p);
    check(`other salesperson gets 404 on ${p.replace(sent.id, "<id>")}`, r.status === 404 && !isPdf(r), `${r.status}`);
  }
  const sig = await s2.get(`/api/files/signature/${sales1.id}`);
  check("other salesperson cannot see sales1's signature", sig.status === 404, `${sig.status}`);
  if (logo) check("logos are visible to signed-in users", (await s2.get(`/api/files/logo/${logo.id}`)).status === 200);
} finally {
  await db.query(`delete from "user" where id = $1`, [otherId]);
}

// ── executive and admin ──
const ex = new Client();
check("executive signs in", (await ex.signIn("exec@example.com")) === 200);
check("executive downloads the PDF", isPdf(await ex.get(paths[0])));
const ad = new Client();
check("admin signs in", (await ad.signIn("admin@example.com")) === 200);
check("admin (not executive) gets 404 on the PDF", (await ad.get(paths[0])).status === 404);
const adSig = await ad.get(`/api/files/signature/${sales1.id}`);
check("admin may see a signature (support)", !sales1.signatureKey || adSig.status === 200, `${adSig.status}`);

// ── stored files are what they claim ──
const emails = await db.query(`select count(*)::int n from quotation_email where "quotationId" = $1`, [sent.id]);
const revs = await db.query(`select "pdfKey" from quotation_revision where "pdfKey" is not null`);
const missing = revs.rows.filter((r) => !fs.existsSync(`${PROJECT}/storage/${r.pdfKey}`));
check("every revision PDF exists in storage", missing.length === 0, `${revs.rowCount} stored, emails for this quotation: ${emails.rows[0].n}`);
const snap = (await db.query(`select snapshot::text s from quotation_revision where "quotationId" = $1 and revision = $2`, [sent.id, sent.revision])).rows[0].s;
check("revision snapshot has the document and no minimum prices or images",
  snap.includes('"document"') && !/"minPriceSatang":\s*\d/.test(snap) && !snap.includes("data:image"));

await db.end();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
