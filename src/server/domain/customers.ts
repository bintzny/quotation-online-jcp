// Customer rules (pure functions — no database or framework imports).
import { hasAnyRole, type Role } from "./roles";

export type Viewer = { id: string; roles: readonly Role[] };
export type CustomerRef = { ownerId: string | null; status: "ACTIVE" | "PENDING_OWNER" | "LOST" };

// ── Identity ──────────────────────────────────────────────────────────

/** Digits only; "0-1055-12345-67-8" → "0105512345678". Returns null unless 13 digits. */
export function normalizeTaxId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const digits = String(input).replace(/[\s-]/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}

/** Thai 13-digit tax / ID number check digit (mod 11). */
export function isValidThaiTaxId(taxId: string): boolean {
  if (!/^\d{13}$/.test(taxId)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(taxId[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(taxId[12]);
}

const HEAD_OFFICE_WORDS = ["สำนักงานใหญ่", "สนญ", "สนญ.", "hq", "head office", "headoffice"];

/** "", "สำนักงานใหญ่", "HQ" → "00000"; "1" → "00001". Returns null when not a branch code. */
export function normalizeBranchCode(input: unknown): string | null {
  if (input === null || input === undefined) return "00000";
  const s = String(input).trim();
  if (s === "" || HEAD_OFFICE_WORDS.includes(s.toLowerCase())) return "00000";
  const digits = s.replace(/^สาขา(ที่)?\s*/, "");
  if (!/^\d{1,5}$/.test(digits)) return null;
  return digits.padStart(5, "0");
}

/** Key used to find the same juristic customer across files and companies. */
export function identityKey(taxId: string | null, branchCode: string): string | null {
  return taxId ? `${taxId}:${branchCode}` : null;
}

const NAME_PREFIXES = /^(นาย|นางสาว|นาง|น\.ส\.|คุณ|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

/** For "might be a duplicate" warnings on individuals: case/space/prefix-insensitive name. */
export function normalizePersonName(name: string): string {
  return name.trim().replace(NAME_PREFIXES, "").replace(/\s+/g, "").toLowerCase();
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("66") && d.length >= 11) d = `0${d.slice(2)}`;
  return d.length >= 9 ? d : null;
}

// ── Access policy ─────────────────────────────────────────────────────

const MANAGERS: readonly Role[] = ["executive", "admin"];

export function isManager(viewer: Viewer): boolean {
  return hasAnyRole(viewer.roles.join(","), MANAGERS);
}

/**
 * Full details (address, contacts, history). Sales see their own customers and
 * unowned active ones; for other customers they only learn the owner's name.
 */
export function canViewCustomer(viewer: Viewer, c: CustomerRef): boolean {
  if (isManager(viewer)) return true;
  if (c.ownerId === viewer.id) return true;
  return c.ownerId === null && c.status === "ACTIVE";
}

export function canEditCustomer(viewer: Viewer, c: CustomerRef): boolean {
  return isManager(viewer) || c.ownerId === viewer.id;
}

export function canChangeOwner(viewer: Viewer): boolean {
  return isManager(viewer);
}

export type OwnershipNotice =
  | { kind: "own" }
  | { kind: "unowned" }
  | { kind: "pending" } // waiting for an executive/admin to choose the owner
  | { kind: "other" } // owned by someone else: only the owner's name may be shown
  | { kind: "lost" };

export function ownershipNotice(viewer: Viewer, c: CustomerRef): OwnershipNotice {
  if (c.status === "PENDING_OWNER") return { kind: "pending" };
  if (c.status === "LOST") return { kind: "lost" };
  if (c.ownerId === null) return { kind: "unowned" };
  return c.ownerId === viewer.id ? { kind: "own" } : { kind: "other" };
}

/** Whether this viewer may start a quotation for the customer (used from M2). */
export function canQuoteFor(viewer: Viewer, c: CustomerRef): boolean {
  if (c.status !== "ACTIVE") return false;
  return c.ownerId === null || c.ownerId === viewer.id;
}
