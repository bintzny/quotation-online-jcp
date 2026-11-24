// Roles are stored by Better Auth's admin plugin as a comma-separated string,
// e.g. "sales,executive". Pure helpers only — no database or framework imports.

export const ROLES = ["sales", "executive", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Roles that must use two-factor authentication (they can see every company's data). */
export const ROLES_REQUIRING_2FA: readonly Role[] = ["executive", "admin"];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Parse a stored role string; unknown values are dropped, duplicates removed, order kept stable. */
export function parseRoles(stored: string | null | undefined): Role[] {
  if (!stored) return [];
  const found = new Set<Role>();
  for (const part of stored.split(",")) {
    const r = part.trim().toLowerCase();
    if (isRole(r)) found.add(r);
  }
  return ROLES.filter((r) => found.has(r));
}

/** Serialize roles for storage. Throws on an empty or invalid list. */
export function serializeRoles(roles: readonly string[]): string {
  const valid = parseRoles(roles.join(","));
  if (valid.length === 0) throw new Error("At least one valid role is required");
  if (valid.length !== new Set(roles.map((r) => r.trim().toLowerCase())).size) {
    throw new Error("Unknown role in list");
  }
  return valid.join(",");
}

export function hasRole(stored: string | null | undefined, role: Role): boolean {
  return parseRoles(stored).includes(role);
}

export function hasAnyRole(stored: string | null | undefined, roles: readonly Role[]): boolean {
  const mine = parseRoles(stored);
  return roles.some((r) => mine.includes(r));
}

export function requires2FA(stored: string | null | undefined): boolean {
  return hasAnyRole(stored, ROLES_REQUIRING_2FA);
}
