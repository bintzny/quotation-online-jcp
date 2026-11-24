import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

// Access control for Better Auth's admin endpoints (user management).
// Only "admin" may manage users. Impersonation is deliberately not granted to anyone:
// it would let one person act as (and see the quotations of) another salesperson.
export const ac = createAccessControl(defaultStatements);

export const roles = {
  admin: ac.newRole({
    user: ["create", "list", "set-role", "ban", "set-password", "get", "update"],
    session: ["list", "revoke"],
  }),
  executive: ac.newRole({ user: [], session: [] }),
  sales: ac.newRole({ user: [], session: [] }),
};
