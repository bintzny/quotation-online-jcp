// Excel import rules: template columns, row validation and the customer merge plan.
// Pure functions — the server action reads the file and applies the plan.
import { isValidThaiTaxId, identityKey, normalizeBranchCode, normalizeTaxId } from "./customers";
import { parseBahtToSatang } from "./money";

export type RowError = { field: string; code: string };

// ── Templates ─────────────────────────────────────────────────────────

export type Column = { key: string; header: string; width: number; required?: boolean; example: string | number };

export const CUSTOMER_COLUMNS: Column[] = [
  { key: "expressCode", header: "รหัสลูกค้า (Express)", width: 18, example: "C0001" },
  { key: "type", header: "ประเภท (นิติบุคคล/บุคคลธรรมดา)", width: 26, required: true, example: "นิติบุคคล" },
  { key: "name", header: "ชื่อลูกค้า", width: 36, required: true, example: "บริษัท ตัวอย่าง จำกัด" },
  { key: "taxId", header: "เลขประจำตัวผู้เสียภาษี", width: 20, example: "0105561234560" },
  { key: "branchCode", header: "รหัสสาขา (00000 = สำนักงานใหญ่)", width: 24, example: "00000" },
  { key: "branchName", header: "ชื่อสาขา", width: 18, example: "สำนักงานใหญ่" },
  { key: "address", header: "ที่อยู่", width: 50, required: true, example: "99 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110" },
  { key: "phone", header: "โทรศัพท์", width: 16, example: "02-123-4567" },
  { key: "email", header: "อีเมล", width: 24, example: "purchase@example.com" },
  { key: "creditDays", header: "เครดิต (วัน)", width: 12, example: 30 },
  { key: "salesCode", header: "รหัสพนักงานขาย", width: 16, example: "S001" },
  { key: "contactName", header: "ชื่อผู้ติดต่อ", width: 22, example: "คุณสมชาย ใจดี" },
  { key: "contactPosition", header: "ตำแหน่งผู้ติดต่อ", width: 18, example: "ฝ่ายจัดซื้อ" },
  { key: "contactPhone", header: "โทรศัพท์ผู้ติดต่อ", width: 16, example: "081-234-5678" },
  { key: "contactEmail", header: "อีเมลผู้ติดต่อ", width: 24, example: "somchai@example.com" },
];

export const PRODUCT_COLUMNS: Column[] = [
  { key: "code", header: "รหัสสินค้า", width: 16, required: true, example: "OPP-48-100" },
  { key: "name", header: "ชื่อสินค้า", width: 36, required: true, example: "เทปกาว OPP 48 มม. x 100 หลา" },
  { key: "nameEn", header: "ชื่อสินค้า (อังกฤษ)", width: 30, example: "OPP tape 48 mm x 100 yd" },
  { key: "category", header: "หมวดสินค้า", width: 16, example: "เทปกาว" },
  { key: "unit", header: "หน่วย", width: 10, required: true, example: "ม้วน" },
  { key: "listPrice", header: "ราคาปกติ (บาท ก่อน VAT)", width: 20, required: true, example: 85 },
  { key: "minPrice", header: "ราคาขั้นต่ำ (บาท ก่อน VAT)", width: 22, example: 80 },
  { key: "isService", header: "รายการบริการ (ใช่/ไม่ใช่)", width: 20, example: "ไม่ใช่" },
  { key: "active", header: "เปิดขาย (ใช่/ไม่ใช่)", width: 16, example: "ใช่" },
];

/** Map a sheet header row to column keys (tolerates extra spaces). Returns missing required headers. */
export function mapHeaders(headerRow: unknown[], columns: Column[]) {
  const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const index: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const col = columns.find((c) => norm(c.header) === norm(h));
    if (col) index[col.key] = i;
  });
  const missing = columns.filter((c) => c.required && index[c.key] === undefined).map((c) => c.header);
  return { index, missing };
}

// ── Helpers ───────────────────────────────────────────────────────────

const text = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s.slice(0, max);
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseYesNo(v: unknown, fallback: boolean): boolean | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return fallback;
  if (["ใช่", "y", "yes", "true", "1", "เปิด"].includes(s)) return true;
  if (["ไม่ใช่", "n", "no", "false", "0", "ปิด"].includes(s)) return false;
  return null;
}

// ── Customers ─────────────────────────────────────────────────────────

export type CustomerRow = {
  rowNumber: number;
  expressCode: string | null;
  type: "JURISTIC" | "INDIVIDUAL";
  name: string;
  taxId: string | null;
  branchCode: string;
  branchName: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  creditDays: number;
  salesCode: string | null;
  contact: { name: string; position: string | null; phone: string | null; email: string | null } | null;
};

export function parseCustomerRow(raw: Record<string, unknown>, rowNumber: number):
  { ok: true; row: CustomerRow } | { ok: false; errors: RowError[] } {
  const errors: RowError[] = [];
  const typeText = String(raw.type ?? "").trim();
  const type = /^(นิติบุคคล|juristic|company|บริษัท)$/i.test(typeText)
    ? "JURISTIC"
    : /^(บุคคลธรรมดา|individual|person|บุคคล)$/i.test(typeText) ? "INDIVIDUAL" : null;
  if (!type) errors.push({ field: "type", code: "customerType" });

  const name = text(raw.name, 200);
  if (!name) errors.push({ field: "name", code: "required" });
  const address = text(raw.address, 1000);
  if (!address) errors.push({ field: "address", code: "required" });

  const rawTax = text(raw.taxId, 30);
  const taxId = rawTax ? normalizeTaxId(rawTax) : null;
  if (rawTax && !taxId) errors.push({ field: "taxId", code: "taxId" });
  else if (taxId && !isValidThaiTaxId(taxId)) errors.push({ field: "taxId", code: "taxIdChecksum" });
  if (type === "JURISTIC" && !rawTax) errors.push({ field: "taxId", code: "taxIdRequired" });

  const branchCode = normalizeBranchCode(raw.branchCode);
  if (!branchCode) errors.push({ field: "branchCode", code: "branchCode" });

  const email = text(raw.email, 200);
  if (email && !EMAIL.test(email)) errors.push({ field: "email", code: "email" });
  const contactEmail = text(raw.contactEmail, 200);
  if (contactEmail && !EMAIL.test(contactEmail)) errors.push({ field: "contactEmail", code: "email" });

  const creditText = String(raw.creditDays ?? "").trim();
  const creditDays = creditText === "" ? 0 : Number(creditText);
  if (!Number.isInteger(creditDays) || creditDays < 0 || creditDays > 365) errors.push({ field: "creditDays", code: "creditDays" });

  if (errors.length) return { ok: false, errors };
  const contactName = text(raw.contactName, 120);
  return {
    ok: true,
    row: {
      rowNumber,
      expressCode: text(raw.expressCode, 40)?.toUpperCase() ?? null,
      type: type!,
      name: name!,
      taxId,
      branchCode: type === "INDIVIDUAL" ? "00000" : branchCode!,
      branchName: text(raw.branchName, 120),
      address: address!,
      phone: text(raw.phone, 50),
      email,
      creditDays,
      salesCode: text(raw.salesCode, 30)?.toUpperCase() ?? null,
      contact: contactName
        ? { name: contactName, position: text(raw.contactPosition, 120), phone: text(raw.contactPhone, 50), email: contactEmail }
        : null,
    },
  };
}

export type ExistingCustomer = {
  id: string;
  key: string | null; // identityKey
  expressCodes: string[]; // codes for the importing company
  ownerId: string | null;
  status: "ACTIVE" | "PENDING_OWNER" | "LOST";
  candidateIds: string[];
  /** Owner was set by a person (created, transferred, chosen by a manager): imports never reopen it. */
  ownerLocked: boolean;
};

export type PlannedCustomer = {
  ref: string; // "e:<id>" for existing customers, "n:<n>" for new ones
  existingId: string | null; // null → create
  key: string | null;
  firstRow: CustomerRow; // data used for a new customer / to fill empty fields
  rows: number[];
  expressCodes: string[];
  previousOwnerId: string | null; // owner before this import (existing customers)
  ownerId: string | null; // owner after import; always null while PENDING_OWNER
  ownerChanged: boolean; // owner newly set by this import (and not pending)
  status: "ACTIVE" | "PENDING_OWNER" | "LOST";
  becamePending: boolean;
  candidateIds: string[]; // all candidates after import (when pending)
};

export type RowOutcome =
  | { row: number; kind: "create" | "update" | "merged" }
  | { row: number; kind: "conflict" }
  | { row: number; kind: "error"; errors: RowError[] };

export type CustomerPlan = {
  customers: PlannedCustomer[];
  outcomes: RowOutcome[];
  unknownSalesCodes: { row: number; code: string }[];
  /** File names a different salesperson than the owner a person already decided on. */
  ownerMismatches: { row: number; customerRef: string; salesCode: string }[];
  /** Individuals with neither tax ID nor Express code: always created as new customers. */
  noIdentityRows: number[];
};

type ParsedItem = { ok: true; row: CustomerRow } | { ok: false; errors: RowError[]; rowNumber: number };

/**
 * Merge import rows into the customer list.
 * - Same tax ID + branch, or the same Express code of this company, is the same customer.
 *   A row whose tax ID and Express code point at two different customers is an error.
 * - The owner comes from the salesperson code. When files disagree about the salesperson of a
 *   customer whose owner came from an import, the customer becomes PENDING_OWNER: no owner,
 *   every suggested salesperson is a candidate, and nobody may quote until a manager decides.
 * - An owner set by a person (created, transferred, decided by a manager) is never changed by an
 *   import; a different salesperson in the file is only reported as a mismatch.
 */
export function planCustomerImport(
  parsed: ParsedItem[],
  existing: ExistingCustomer[],
  userIdBySalesCode: Map<string, string>,
): CustomerPlan {
  const customers: PlannedCustomer[] = [];
  const outcomes: RowOutcome[] = [];
  const unknownSalesCodes: CustomerPlan["unknownSalesCodes"] = [];
  const ownerMismatches: CustomerPlan["ownerMismatches"] = [];
  const noIdentityRows: number[] = [];

  const existingByKey = new Map(existing.filter((e) => e.key).map((e) => [e.key!, e]));
  const existingByCode = new Map(existing.flatMap((e) => e.expressCodes.map((c) => [c, e] as const)));
  const locked = new Map(existing.map((e) => [e.id, e.ownerLocked]));
  const planByRef = new Map<string, PlannedCustomer>();
  const refByKey = new Map<string, string>();
  const refByCode = new Map<string, string>();
  let newCount = 0;

  const refOfExisting = (e: ExistingCustomer) => `e:${e.id}`;
  const keyOfRef = (ref: string): string | null =>
    planByRef.get(ref)?.key ?? existing.find((e) => refOfExisting(e) === ref)?.key ?? null;

  function planFor(ref: string, row: CustomerRow): PlannedCustomer {
    let p = planByRef.get(ref);
    if (p) return p;
    const e = existing.find((x) => refOfExisting(x) === ref)!;
    p = {
      ref, existingId: e.id, key: e.key, firstRow: row, rows: [], expressCodes: [...e.expressCodes],
      previousOwnerId: e.ownerId, ownerId: e.ownerId, ownerChanged: false, status: e.status,
      becamePending: false, candidateIds: [...e.candidateIds],
    };
    planByRef.set(ref, p);
    customers.push(p);
    return p;
  }

  for (const item of parsed) {
    if (!item.ok) {
      outcomes.push({ row: item.rowNumber, kind: "error", errors: item.errors });
      continue;
    }
    const row = item.row;
    const key = identityKey(row.taxId, row.branchCode);

    const refFromKey = key ? (refByKey.get(key) ?? (existingByKey.get(key) && refOfExisting(existingByKey.get(key)!))) : undefined;
    const refFromCode = row.expressCode
      ? (refByCode.get(row.expressCode) ?? (existingByCode.get(row.expressCode) && refOfExisting(existingByCode.get(row.expressCode)!)))
      : undefined;

    // The Express code already belongs to a different customer than the tax ID says.
    const codeKey = refFromCode ? keyOfRef(refFromCode) : null;
    if ((refFromKey && refFromCode && refFromKey !== refFromCode) || (!refFromKey && refFromCode && key && codeKey && codeKey !== key)) {
      outcomes.push({ row: row.rowNumber, kind: "error", errors: [{ field: "expressCode", code: "expressCodeConflict" }] });
      continue;
    }

    const ref = refFromKey ?? refFromCode;
    let kind: "create" | "update" | "merged";
    let plan: PlannedCustomer;
    if (ref) {
      plan = planFor(ref, row); // existing plan (new or existing customer) or a fresh one for an existing customer
      kind = plan.rows.length > 0 ? "merged" : "update";
    } else {
      newCount += 1;
      plan = {
        ref: `n:${newCount}`, existingId: null, key, firstRow: row, rows: [], expressCodes: [], previousOwnerId: null,
        ownerId: null, ownerChanged: false, status: "ACTIVE", becamePending: false, candidateIds: [],
      };
      planByRef.set(plan.ref, plan);
      customers.push(plan);
      kind = "create";
      if (!key && !row.expressCode) noIdentityRows.push(row.rowNumber);
    }
    plan.rows.push(row.rowNumber);
    if (key) refByKey.set(key, plan.ref);
    if (row.expressCode) {
      refByCode.set(row.expressCode, plan.ref);
      if (!plan.expressCodes.includes(row.expressCode)) plan.expressCodes.push(row.expressCode);
    }

    let conflict = false;
    if (row.salesCode) {
      const userId = userIdBySalesCode.get(row.salesCode);
      const isLocked = plan.existingId ? (locked.get(plan.existingId) ?? false) : false;
      if (!userId) {
        unknownSalesCodes.push({ row: row.rowNumber, code: row.salesCode });
      } else if (plan.status === "LOST") {
        // lost customers keep their owner; reassigning them is a manager decision (M6)
      } else if (plan.status === "PENDING_OWNER") {
        if (!plan.candidateIds.includes(userId)) plan.candidateIds.push(userId);
        conflict = true;
      } else if (plan.ownerId === null) {
        plan.ownerId = userId;
        plan.ownerChanged = true;
      } else if (plan.ownerId !== userId) {
        if (isLocked && plan.ownerId === plan.previousOwnerId) {
          ownerMismatches.push({ row: row.rowNumber, customerRef: plan.ref, salesCode: row.salesCode });
        } else {
          for (const id of [plan.ownerId, userId]) if (!plan.candidateIds.includes(id)) plan.candidateIds.push(id);
          plan.status = "PENDING_OWNER";
          plan.becamePending = true;
          plan.ownerId = null; // nobody owns (or may quote) a pending customer
          plan.ownerChanged = false;
          conflict = true;
        }
      }
    }
    outcomes.push({ row: row.rowNumber, kind: conflict ? "conflict" : kind });
  }

  return { customers, outcomes, unknownSalesCodes, ownerMismatches, noIdentityRows };
}


// ── Products ──────────────────────────────────────────────────────────

export type ProductRow = {
  rowNumber: number;
  code: string;
  name: string;
  nameEn: string | null;
  category: string | null;
  unit: string;
  listPriceSatang: number;
  minPriceSatang: number | null;
  isService: boolean;
  active: boolean;
};

export function parseProductRow(raw: Record<string, unknown>, rowNumber: number):
  { ok: true; row: ProductRow } | { ok: false; errors: RowError[] } {
  const errors: RowError[] = [];
  const code = text(raw.code, 40)?.toUpperCase() ?? null;
  if (!code) errors.push({ field: "code", code: "required" });
  else if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)) errors.push({ field: "code", code: "productCode" });
  const name = text(raw.name, 200);
  if (!name) errors.push({ field: "name", code: "required" });
  const unit = text(raw.unit, 30);
  if (!unit) errors.push({ field: "unit", code: "required" });

  const listPriceSatang = parseBahtToSatang(raw.listPrice);
  if (listPriceSatang === null) errors.push({ field: "listPrice", code: "price" });
  const isService = parseYesNo(raw.isService, false);
  if (isService === null) errors.push({ field: "isService", code: "yesNo" });
  const active = parseYesNo(raw.active, true);
  if (active === null) errors.push({ field: "active", code: "yesNo" });

  const minText = String(raw.minPrice ?? "").trim();
  let minPriceSatang: number | null = null;
  if (minText !== "") {
    minPriceSatang = parseBahtToSatang(raw.minPrice);
    if (minPriceSatang === null) errors.push({ field: "minPrice", code: "price" });
  } else if (isService === false) {
    errors.push({ field: "minPrice", code: "minPriceRequired" });
  }
  if (listPriceSatang !== null && minPriceSatang !== null && minPriceSatang > listPriceSatang) {
    errors.push({ field: "minPrice", code: "minAboveList" });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    row: {
      rowNumber, code: code!, name: name!, nameEn: text(raw.nameEn, 200), category: text(raw.category, 60),
      unit: unit!, listPriceSatang: listPriceSatang!, minPriceSatang, isService: isService!, active: active!,
    },
  };
}

// ── Last sale dates from Express (M6) ─────────────────────────────────

export const LAST_SALE_COLUMNS: Column[] = [
  { key: "expressCode", header: "รหัสลูกค้า (Express)", width: 18, example: "C0001" },
  { key: "taxId", header: "เลขประจำตัวผู้เสียภาษี", width: 20, example: "0105561234560" },
  { key: "branchCode", header: "รหัสสาขา (00000 = สำนักงานใหญ่)", width: 24, example: "00000" },
  { key: "name", header: "ชื่อลูกค้า", width: 36, example: "บริษัท ตัวอย่าง จำกัด" },
  { key: "lastSaleDate", header: "วันที่ขายล่าสุด", width: 16, required: true, example: "20/11/2569" },
  { key: "sales12m", header: "ยอดขาย 12 เดือนล่าสุด (บาท ก่อน VAT)", width: 26, example: 125000 },
];

export type LastSaleRow = {
  rowNumber: number;
  expressCode: string | null;
  taxId: string | null;
  branchCode: string;
  lastSaleDate: Date;
  sales12mSatang: number | null; // null = column empty (keep the stored figure)
};

/** `parseDate` / `checkDate` come from the dormant rules (kept there with the other date rules). */
export function parseLastSaleRow(
  raw: Record<string, unknown>,
  rowNumber: number,
  parseDate: (v: unknown) => Date | null,
  checkDate: (d: Date) => string | null,
): { ok: true; row: LastSaleRow; amountIgnored: boolean } | { ok: false; errors: RowError[] } {
  const errors: RowError[] = [];
  const expressCode = text(raw.expressCode, 40)?.toUpperCase() ?? null;
  const rawTax = text(raw.taxId, 30);
  const taxId = rawTax ? normalizeTaxId(rawTax) : null;
  if (rawTax && !taxId) errors.push({ field: "taxId", code: "taxId" });
  const branchCode = normalizeBranchCode(raw.branchCode);
  if (!branchCode) errors.push({ field: "branchCode", code: "branchCode" });
  if (!expressCode && !rawTax) errors.push({ field: "expressCode", code: "codeOrTaxIdRequired" });

  const date = parseDate(raw.lastSaleDate);
  if (!date) errors.push({ field: "lastSaleDate", code: raw.lastSaleDate === null || raw.lastSaleDate === undefined || raw.lastSaleDate === "" ? "required" : "date" });
  else {
    const bad = checkDate(date);
    if (bad) errors.push({ field: "lastSaleDate", code: bad });
  }

  // The amount is optional: an unreadable one is ignored (reported), the sale date is still used.
  const amountText = String(raw.sales12m ?? "").replace(/[,\s฿]|บาท/g, "");
  let sales12mSatang: number | null = null;
  let amountIgnored = false;
  if (amountText !== "") {
    sales12mSatang = parseBahtToSatang(amountText, 1_000_000_000_000);
    if (sales12mSatang === null) amountIgnored = true;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, row: { rowNumber, expressCode, taxId, branchCode: branchCode!, lastSaleDate: date!, sales12mSatang }, amountIgnored };
}

export type LastSaleMatch = { customerId: string; rowNumber: number; lastSaleDate: Date; sales12mSatang: number | null };

/**
 * Match rows to customers: the Express code of this company first, then tax ID + branch. A code and
 * a tax ID that point to different customers is an error. Several rows for one customer: the latest
 * sale date wins.
 */
export function matchLastSales(
  rows: LastSaleRow[],
  byCode: Map<string, string>,
  byIdentity: Map<string, string>,
): { matches: LastSaleMatch[]; notFound: number[]; errors: { row: number; errors: RowError[] }[] } {
  const best = new Map<string, LastSaleMatch>();
  const notFound: number[] = [];
  const errors: { row: number; errors: RowError[] }[] = [];
  for (const r of rows) {
    const viaCode = r.expressCode ? byCode.get(r.expressCode) : undefined;
    const key = identityKey(r.taxId, r.branchCode);
    const viaTax = key ? byIdentity.get(key) : undefined;
    if (viaCode && viaTax && viaCode !== viaTax) {
      errors.push({ row: r.rowNumber, errors: [{ field: "expressCode", code: "codeTaxIdMismatch" }] });
      continue;
    }
    const customerId = viaCode ?? viaTax;
    if (!customerId) { notFound.push(r.rowNumber); continue; }
    const prev = best.get(customerId);
    if (!prev || r.lastSaleDate > prev.lastSaleDate) {
      best.set(customerId, { customerId, rowNumber: r.rowNumber, lastSaleDate: r.lastSaleDate, sales12mSatang: r.sales12mSatang });
    }
  }
  return { matches: [...best.values()], notFound, errors };
}
