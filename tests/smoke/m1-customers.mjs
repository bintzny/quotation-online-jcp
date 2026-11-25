// Run: node --env-file=.env tests/smoke/m1-customers.mjs
// Needs the dev server on :3000, the demo seed, M0 smoke run (sales1 password set) and the
// M1 test imports (customers "บริษัท ทดสอบ หนึ่ง จำกัด" owned by sales2, products OPP-48-100 etc.).
// Checks what a salesperson can read: other owners' customers and minimum prices must not leak.
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const pg = createRequire(`${PROJECT}/package.json`)("pg");
const BASE = "http://localhost:3000";
const creds = Object.fromEntries(
  fs.readFileSync(`${PROJECT}/.dev-credentials.txt`, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t")).map(([e, p]) => [e, p]),
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

let cookie = "";
async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: creds[email] }),
  });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return res.status;
}
async function page(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

const one = (await db.query(`select id, address, "taxId" from customer where name = 'บริษัท ทดสอบ หนึ่ง จำกัด'`)).rows[0];
const unowned = (await db.query(`select id, address from customer where name = 'บริษัท ไม่มีผู้ดูแล จำกัด'`)).rows[0];
const product = (await db.query(`select id from product where code = 'OPP-48-100'`)).rows[0];
if (!one || !unowned || !product) throw new Error("M1 test data missing — run the test imports first");

check("sales1 signs in", (await signIn("sales1@example.com")) === 200);

const other = await page(`/customers/${one.id}`);
check("other owner's customer: notice with owner name", other.status === 200 && other.text.includes("ดูแลโดย คุณพนักงานขาย สอง"));
check("other owner's customer: address not in page", !other.text.includes(one.address));
check("other owner's customer: tax ID not in page", !other.text.includes(one.taxId));

const list = await page(`/customers?scope=all`);
check("customer list (all): other owner's tax ID hidden", list.status === 200 && !list.text.includes(one.taxId));
check("customer list (all): name and owner visible", list.text.includes("บริษัท ทดสอบ หนึ่ง จำกัด") && list.text.includes("พนักงานขาย สอง"));

const prefix = await page(`/customers?scope=all&q=${one.taxId.slice(0, 6)}`);
check("tax ID prefix search does not match other owners' customers", prefix.status === 200 && !prefix.text.includes("บริษัท ทดสอบ หนึ่ง จำกัด"));
const exact = await page(`/customers?scope=all&q=${one.taxId}`);
check("a complete 13-digit tax ID still finds the customer (owner shown)", exact.text.includes("บริษัท ทดสอบ หนึ่ง จำกัด"));

const free = await page(`/customers/${unowned.id}`);
check("unowned customer: full details visible to sales", free.status === 200 && free.text.includes(unowned.address));

const products = await page(`/products`);
check("products: list price visible", products.status === 200 && products.text.includes("85.00"));
// Translation labels contain the word "minPrice"; the data field and the values must not appear.
check(
  "products: minimum price values not in page or payload",
  !products.text.includes("minPriceSatang") && !["80.00", "42.00", "8000", "4200"].some((v) => products.text.includes(v)),
);

for (const p of ["/customers/pending", "/admin/import", "/products/new", `/products/${product.id}`]) {
  const r = await page(p);
  check(`sales gets 404 on ${p}`, r.status === 404, `${r.status}`);
}
const tpl = await page(`/api/templates/customers`);
check("sales cannot download import templates", tpl.status === 404, `${tpl.status}`);

await db.end();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
