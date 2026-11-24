import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { hasAnyRole, parseRoles, requires2FA, type Role } from "@/server/domain/roles";

// Data Access Layer for the signed-in user. Every page and server action must go
// through requireUser()/requireRole(); never trust anything the browser sends about identity.

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  companyId: string | null;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
};

/** The signed-in user, read fresh from the database (role changes apply immediately). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, name: true, email: true, role: true, banned: true,
      companyId: true, mustChangePassword: true, twoFactorEnabled: true,
    },
  });
  if (!u || u.banned) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roles: parseRoles(u.role),
    companyId: u.companyId,
    mustChangePassword: u.mustChangePassword,
    twoFactorEnabled: !!u.twoFactorEnabled,
  };
});

/** Where an incomplete account must go before using the app, or null when it is ready. */
export function onboardingRedirect(user: CurrentUser): string | null {
  if (user.mustChangePassword) return "/change-password";
  if (requires2FA(user.roles.join(",")) && !user.twoFactorEnabled) return "/setup-2fa";
  return null;
}

type RequireOptions = { allowOnboarding?: boolean };

/** Signed-in, fully set-up user. Redirects to /login or to the pending onboarding step. */
export async function requireUser(opts: RequireOptions = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!opts.allowOnboarding) {
    const next = onboardingRedirect(user);
    if (next) redirect(next);
  }
  return user;
}

/** Signed-in user holding at least one of the roles; others get a 404 (no hint the page exists). */
export async function requireRole(roles: readonly Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasAnyRole(user.roles.join(","), roles)) notFound();
  return user;
}
