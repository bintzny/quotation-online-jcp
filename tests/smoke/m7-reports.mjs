// Run: node --env-file=.env tests/smoke/m7-reports.mjs
// Needs the dev server on :3000, the demo seed (passwords and TOTP secrets in .dev-credentials.txt),
// at least one quotation of sales1 that was sent, and no quotations dated in 2024 (the fixtures use
// March 2024 so other data cannot change the expected numbers).
// A temporary company with seven quotations and a target are created and removed by the test.
// Expected numbers are worked out by hand below, independently of the report code:
//   March 2024 (Bangkok), temporary company:
//   Q1 sales1  first sent 1 Mar 00:30  Won 10 Mar          12,345.00
//   Q2 sales1  first sent 29 Feb 23:30 Lost (price) 5 Mar    5,678.00  → proposed in February
//   Q3 sales2  first sent 15 Mar       Expired 20 Mar       20,001.00
//   Q4 sales2  first sent 16 Mar       Cancelled               999.00  → never counted
//   Q5 owned by sales2 now, first sent by sales1 3 Mar, open 3,007.00 → proposed credited to sales1
//   Q6 sales2  first sent 10 Feb       Won 31 Mar 23:30      7,003.00
//   Q7 sales1  first sent 1 Mar        Won 1 Apr 00:10         509.00  → Won in April
//   proposed = Q1 + Q3 + Q5 + Q7 = 35,862.00 (4)   Won = Q1 + Q6 = 19,348.00 (2)
//   win rate by value = 19,348 / (19,348 + 5,678 + 20,001) = 43%, by count 2 / 4 = 50%
//   sales1: proposed 15,861.00, Won 12,345.00; target 24,690.00 → 50%
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const req = createRequire(`${PROJECT}/package.json`);
const pg = req("pg");
const ExcelJS = req("exceljs");
const BASE = "http://localhost:3000";
const credText = fs.readFileSync(`${PROJECT}/.dev-credentials.txt`, "utf8");
const creds = Object.fromEntries(credText.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.trim().split("\t")));
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
    return { status: res.status, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "", buf: Buffer.from(await res.arrayBuffer()) };
  }
  async page(p) { const r = await this.get(p); return { ...r, text: r.buf.toString("utf8") }; }
}

const user = async (email) => (await db.query(`select id from "user" where email = $1`, [email])).rows[0].id;
const sales1 = await user("sales1@example.com");
const sales2 = await user("sales2@example.com");
const src = (await db.query(`select id, "companyId", "customerTaxId" from quotation where "ownerId" = $1 and "sentAt" is not null order by "createdAt" limit 1`, [sales1])).rows[0];
if (!src) throw new Error("No sent quotation of sales1 — send one in the app first");
const taxWithDashes = (src.customerTaxId ?? "").replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/,"$1-$2-$3-$4-$5");
const clash = (await db.query(`select count(*)::int n from quotation where "firstSentAt" between '2024-01-01' and '2025-01-01' or "closedAt" between '2024-01-01' and '2025-01-01' or "expiredAt" between '2024-01-01' and '2025-01-01'`)).rows[0].n;
if (clash > 0) throw new Error("There are quotations dated 2024 — the expected numbers would not hold");
const qcols = (await db.query(`select column_name from information_schema.columns where table_name = 'quotation' and table_schema = 'public'`)).rows.map((r) => r.column_name);

const tag = crypto.randomBytes(3).toString("hex").toUpperCase();
const companyId = `smokeco${tag.toLowerCase()}`;
const quotations = [];
const at = (bkk) => new Date(`${bkk}+07:00`); // Bangkok wall clock → instant
async function q(name, o) {
  const id = `smoke${crypto.randomBytes(6).toString("hex")}`;
  const values = {
    id, number: `QT-S${tag}-${String(quotations.length + 1).padStart(4, "0")}`, revision: 0, version: 1, companyId,
    customerName: `SMOKE M7 ${name} ${tag}`, closedAt: null, expiredAt: null, lostReason: null, cancelledAt: null, ownerSince: null,
    createdAt: o.firstSentAt ?? new Date("2024-01-05T03:00:00Z"), ...o,
  };
  values.subtotalSatang = values.afterDiscountSatang;
  values.billDiscountSatang = 0;
  values.vatSatang = Math.round(values.afterDiscountSatang * 0.07);
  values.totalSatang = values.afterDiscountSatang + values.vatSatang;
  const list = qcols.map((c) => `"${c}"`).join(", ");
  const sel = qcols.map((c) => (c in values ? `$${Object.keys(values).indexOf(c) + 2}` : `"${c}"`)).join(", ");
  quotations.push(id);
  await db.query(`insert into quotation (${list}) select ${sel} from quotation where id = $1`, [src.id, ...Object.values(values)]);
  return id;
}
async function item(quotationId, position, code, qtyMilli, netSatang, billShareSatang) {
  await db.query(
    `insert into quotation_item (id, "quotationId", position, "productCode", name, unit, "quantityMilli", "unitPriceSatang", "discountSatang", "netSatang", "billShareSatang")
     values ($1, $2, $3, $4, $5, 'ชิ้น', $6, $7, 0, $8, $9)`,
    [`smokeitem${crypto.randomBytes(6).toString("hex")}`, quotationId, position, code, `SMOKE ITEM ${code}`, qtyMilli, Math.round(netSatang * 1000 / qtyMilli), netSatang, billShareSatang],
  );
}

let exec;
try {
  await db.query(`insert into company (id, code, "nameTh", "taxId", "addressTh", "createdAt", "updatedAt") values ($1, $2, 'SMOKE M7 CO', '0000000000000', 'smoke', now(), now())`, [companyId, `S${tag}`]);
  const won = (o) => ({ status: "WON", poNumber: `PO-${tag}`, poDate: new Date("2024-03-01T00:00:00Z"), ...o });
  const Q1 = await q("Q1", won({ ownerId: sales1, firstSentById: sales1, firstSentAt: at("2024-03-01T00:30:00"), closedAt: at("2024-03-10T11:00:00"), afterDiscountSatang: 1_234_500 }));
  await q("Q2", { status: "LOST", lostReason: "PRICE", ownerId: sales1, firstSentById: sales1, firstSentAt: at("2024-02-29T23:30:00"), closedAt: at("2024-03-05T09:00:00"), afterDiscountSatang: 567_800 });
  await q("Q3", { status: "EXPIRED", ownerId: sales2, firstSentById: sales2, firstSentAt: at("2024-03-15T10:00:00"), expiredAt: at("2024-03-20T01:00:00"), afterDiscountSatang: 2_000_100 });
  await q("Q4", { status: "CANCELLED", ownerId: sales2, firstSentById: sales2, firstSentAt: at("2024-03-16T10:00:00"), cancelledAt: at("2024-03-17T10:00:00"), afterDiscountSatang: 99_900 });
  await q("Q5", { status: "SENT", ownerId: sales2, firstSentById: sales1, ownerSince: at("2024-03-20T10:00:00"), firstSentAt: at("2024-03-03T10:00:00"), afterDiscountSatang: 300_700 });
  const Q6 = await q("Q6", won({ ownerId: sales2, firstSentById: sales2, firstSentAt: at("2024-02-10T10:00:00"), closedAt: at("2024-03-31T23:30:00"), afterDiscountSatang: 700_300 }));
  await q("Q7", won({ ownerId: sales1, firstSentById: sales1, firstSentAt: at("2024-03-01T09:00:00"), closedAt: at("2024-04-01T00:10:00"), afterDiscountSatang: 50_900 }));
  // Q1: two lines with a bill discount share (Σ line values = 12,345.00); Q6 one line
  await item(Q1, 0, `A${tag}`, 3000, 1_000_000, 33_333);
  await item(Q1, 1, `B${tag}`, 1500, 267_833, 0);
  await item(Q6, 0, `C${tag}`, 1000, 700_300, 0);
  await db.query(`insert into sales_target (id, "userId", month, "amountSatang", "updatedAt") values ($1, $2, '2024-03-01', 2469000, now())`, [`smoketarget${tag}`, sales1]);

  // ── executive dashboard, one company ──
  exec = new Client();
  check("executive signs in", (await exec.signIn("exec@example.com")) === 200);
  const dash = await exec.page(`/dashboard?month=2024-03&company=${companyId}`);
  const tx = dash.text;
  check("dashboard opens", dash.status === 200);
  check("proposed = Q1+Q3+Q5+Q7 (first-sent month, Bangkok boundary, cancelled excluded)", tx.includes("35,862.00"));
  check("Won = Q1 + Q6 (closed 31 Mar 23:30 Bangkok counts in March; 1 Apr 00:10 does not)", tx.includes("19,348.00"));
  check("win rate by value 43% and by count 50%", tx.includes("43%") && tx.includes("50%"));
  check("per salesperson: sales1 proposed includes the transferred Q5 (sent by sales1)", tx.includes("15,861.00") && tx.includes("12,345.00"));
  check("per salesperson: sales2", tx.includes("20,001.00") && tx.includes("7,003.00"));
  check("company filter: target not compared", /เป้าตั้งรวมทุกบริษัท|Targets cover all companies/.test(tx));
  check("lost reason listed", /ราคาสูงเกินไป|Price too high/i.test(tx) && tx.includes("5,678.00"));
  check("cancelled Q4 is nowhere in the figures", !tx.includes("999.00"));

  const own = await exec.page(`/dashboard?month=2024-03&owner=${sales1}`);
  check("sales1 against target: 12,345 of 24,690 = 50%", own.text.includes("24,690.00") && own.text.includes("50%") && own.text.includes("12,345.00"));
  const april = await exec.page(`/dashboard?month=2024-04&company=${companyId}`);
  const plain = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("April headline Won is Q7 only", /Won\) 509\.00 (1 ใบ|1 quotation)/.test(plain(april.text)));

  // ── report page and exports agree with the dashboard ──
  const rep = await exec.page(`/reports?basis=closed&from=2024-03-01&to=2024-03-31&company=${companyId}`);
  check("report (closed basis) lists Won, Lost and Expired of March", rep.status === 200 && ["Q1", "Q2", "Q3", "Q6"].every((n) => rep.text.includes(`SMOKE M7 ${n} ${tag}`)) && !rep.text.includes(`SMOKE M7 Q7 ${tag}`));
  check("report total = 12,345 + 5,678 + 20,001 + 7,003 = 45,027.00", rep.text.includes("45,027.00"));
  const repSent = await exec.page(`/reports?basis=sent&from=2024-03-01&to=2024-03-31&company=${companyId}`);
  check("report (sent basis) = dashboard proposed 35,862.00, cancelled Q4 left out", repSent.text.includes("35,862.00") && !repSent.text.includes(`SMOKE M7 Q4 ${tag}`));
  const repCancelled = await exec.page(`/reports?basis=sent&from=2024-03-01&to=2024-03-31&company=${companyId}&status=CANCELLED`);
  check("…but listed when asking for cancelled quotations", repCancelled.text.includes(`SMOKE M7 Q4 ${tag}`));
  const repSender = await exec.page(`/reports?basis=sent&from=2024-03-01&to=2024-03-31&company=${companyId}&owner=${sales1}`);
  check("executive report by sender matches sales1's proposed value (15,861.00, includes transferred Q5)", repSender.text.includes("15,861.00") && repSender.text.includes(`SMOKE M7 Q5 ${tag}`));
  const dashes = await exec.page(`/reports?basis=closed&from=2024-03-01&to=2024-03-31&company=${companyId}&q=${encodeURIComponent(taxWithDashes)}`);
  check("customer search accepts a tax ID with dashes", dashes.text.includes(`SMOKE M7 Q1 ${tag}`));
  const all = await exec.page(`/dashboard?month=2024-03`);
  check("headline attainment compares only salespeople with a target (12,345 of 24,690 = 50%)", all.text.includes("50%") && /เทียบเฉพาะ 1 จาก|Compared for the 1 of/.test(all.text));

  const xl = await exec.get(`/api/reports/won-lines?from=2024-03-01&to=2024-03-31&company=${companyId}`);
  check("Won export downloads an xlsx with a UTF-8 file name, not cached", xl.status === 200 && xl.type.includes("spreadsheetml") && xl.disposition.includes("filename*=UTF-8''"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xl.buf);
  const lines = wb.worksheets[0];
  const header = lines.getRow(5).values;
  const valueCol = header.findIndex((v) => /มูลค่าหลังส่วนลด|Line value/.test(String(v)));
  const numberCol = header.findIndex((v) => /^(เลขที่|Number)$/.test(String(v)));
  let sum = 0; let rows = 0; const numbers = new Set();
  lines.eachRow((row, i) => { if (i > 5 && typeof row.getCell(valueCol).value === "number") { sum += row.getCell(valueCol).value; rows++; numbers.add(row.getCell(numberCol).value); } });
  check("Won export: one row per line (3), only March Won", rows === 3 && numbers.size === 2, `rows ${rows}`);
  check("Won export: Σ line values = Won on the dashboard (19,348.00)", Math.round(sum * 100) === 1_934_800, String(sum));
  const summary = wb.worksheets[1];
  let mismatch = 0;
  summary.eachRow((row, i) => { if (i > 5 && row.getCell(1).value) { const c = String(row.getCell(row.cellCount).value ?? ""); if (c && !/ตรงกับยอดใบ|Matches/.test(c)) mismatch++; } });
  check("Won export: every quotation's lines add up to its value", mismatch === 0);
  const totalRow = lines.getRow(5 + rows + 2).getCell(valueCol).value;
  check("Won export: total row (after a gap) is a SUBTOTAL formula with its result", typeof totalRow === "object" && /^SUBTOTAL\(109,/.test(totalRow.formula) && Math.round(totalRow.result * 100) === 1_934_800);
  check("Won export: title says it counts by the date won", /วันที่ได้งาน|date won/.test(String(lines.getCell(2, 1).value)));

  const qx = await exec.get(`/api/reports/quotations?basis=closed&from=2024-03-01&to=2024-03-31&company=${companyId}`);
  const wq = new ExcelJS.Workbook();
  await wq.xlsx.load(qx.buf);
  const qs = wq.worksheets[0];
  let qsum = 0;
  const bv = qs.getRow(5).values.findIndex((v) => /^(ก่อน VAT|Before VAT)$/.test(String(v)));
  qs.eachRow((row, i) => { if (i > 5 && typeof row.getCell(bv).value === "number") qsum += row.getCell(bv).value; });
  check("quotation export total = report total (45,027.00)", Math.round(qsum * 100) === 4_502_700, String(qsum));

  // ── who may see what ──
  const s1 = new Client();
  check("sales1 signs in", (await s1.signIn("sales1@example.com")) === 200);
  const sd = await s1.page(`/dashboard?month=2024-03&owner=${sales2}&company=${companyId}`);
  check("salesperson dashboard shows only their own numbers even with ?owner=", sd.status === 200 && sd.text.includes("15,861.00") && !sd.text.includes("20,001.00") && !sd.text.includes("35,862.00"));
  const sr = await s1.page(`/reports?basis=closed&from=2024-03-01&to=2024-03-31&company=${companyId}&owner=${sales2}`);
  check("salesperson report lists only their own quotations", sr.text.includes(`SMOKE M7 Q1 ${tag}`) && !sr.text.includes(`SMOKE M7 Q6 ${tag}`) && !sr.text.includes(`SMOKE M7 Q3 ${tag}`));
  const sx = await s1.get(`/api/reports/won-lines?from=2024-03-01&to=2024-03-31&company=${companyId}&owner=${sales2}`);
  const ws = new ExcelJS.Workbook();
  await ws.xlsx.load(sx.buf);
  let sRows = 0; let other = false;
  ws.worksheets[0].eachRow((row, i) => { if (i > 5) { const v = row.values.join("|"); if (v.includes(`C${tag}`)) other = true; if (v.includes(`A${tag}`) || v.includes(`B${tag}`)) sRows++; } });
  check("salesperson Won export holds only their own lines", sRows === 2 && !other);
  check("salesperson: no targets page, no audit log", (await s1.get("/targets")).status === 404 && (await s1.get("/audit")).status === 404);

  const admin = new Client();
  check("admin signs in", (await admin.signIn("admin@example.com")) === 200);
  check("admin: no dashboard, reports or sales exports", (await admin.get("/dashboard")).status === 404 && (await admin.get("/reports")).status === 404 && (await admin.get("/api/reports/won-lines")).status === 404);
  check("admin: targets page and audit log open", (await admin.get("/targets")).status === 200 && (await admin.get("/audit")).status === 200);
  const adminAudit = await admin.page(`/audit?type=quotation`);
  check("admin audit log shows quotation actions without the amounts", adminAudit.status === 200 && !/valueBeforeVat/.test(adminAudit.text));
  check("anonymous export is 404", (await new Client().get("/api/reports/quotations")).status === 404);
  const execAudit = await exec.page(`/audit?action=target.update`);
  check("executive audit log opens with an action filter", execAudit.status === 200);
  const dormantX = await exec.get(`/api/reports/dormant?company=${companyId}`);
  check("inactive-customer export with a company filter downloads", dormantX.status === 200 && dormantX.type.includes("spreadsheetml"));
} finally {
  await db.query(`delete from quotation_item where "quotationId" = any($1)`, [quotations]);
  await db.query(`delete from quotation where id = any($1)`, [quotations]);
  await db.query(`delete from sales_target where id = $1`, [`smoketarget${tag}`]);
  await db.query(`delete from company where id = $1`, [companyId]);
  await db.end();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
