import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import { ac, roles } from "@/lib/permissions";
import { prisma } from "@/server/db";
import { sendMail } from "@/server/mail";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "@/server/domain/lockout";
import { isBlockedOverHttp } from "@/server/domain/auth-routes";
import { ipConfig } from "@/server/domain/client-ip";

const clientIpHeader = ipConfig().header;

export const ACCOUNT_LOCKED = "ACCOUNT_LOCKED";

function normalizeEmail(email: unknown): string | null {
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

/**
 * Reserve one sign-in attempt atomically, before the password is checked.
 * Returns the attempt number, or null when the account is locked (or unknown).
 * Concurrent requests each get a distinct number, so at most MAX_FAILED_LOGINS
 * passwords are ever checked before the account locks.
 */
async function reserveAttempt(email: string): Promise<{ exists: boolean; attempt: number | null }> {
  const rows = await prisma.$queryRaw<{ failedLoginCount: number }[]>`
    UPDATE "user"
       SET "failedLoginCount" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedLoginCount" + 1 END,
           "lockedUntil" = NULL
     WHERE email = ${email} AND ("lockedUntil" IS NULL OR "lockedUntil" <= now())
 RETURNING "failedLoginCount"`;
  if (rows.length) return { exists: true, attempt: rows[0].failedLoginCount };
  const exists = (await prisma.user.count({ where: { email } })) > 0;
  return { exists, attempt: null };
}

async function lockAccount(email: string) {
  await prisma.$executeRaw`
    UPDATE "user"
       SET "lockedUntil" = now() + make_interval(mins => ${LOCK_MINUTES}), "failedLoginCount" = 0
     WHERE email = ${email}`;
}

async function clearAttempts(email: string) {
  await prisma.user.updateMany({
    where: { email, OR: [{ failedLoginCount: { not: 0 } }, { lockedUntil: { not: null } }] },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}

export const auth = betterAuth({
  appName: "Quotation JCP",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.APP_URL ? [process.env.APP_URL] : [],
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // Accounts are created by an admin only.
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "ตั้งรหัสผ่านใหม่ / Reset your password — Quotation JCP",
        text: `เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ 1 ชั่วโมง)\nOpen this link to set a new password (valid 1 hour):\n${url}`,
      });
    },
    // The user chose this password themselves via the emailed link: unlock and drop the
    // "must change temporary password" step.
    onPasswordReset: async ({ user }) => {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, mustChangePassword: false },
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh expiry once a day of use
  },

  user: {
    // App fields are never writable through the public update-user endpoint.
    additionalFields: {
      phone: { type: "string", required: false, input: false },
      employeeCode: { type: "string", required: false, input: false },
      companyId: { type: "string", required: false, input: false },
      mustChangePassword: { type: "boolean", required: false, defaultValue: true, input: false },
      failedLoginCount: { type: "number", required: false, defaultValue: 0, input: false, returned: false },
      lockedUntil: { type: "date", required: false, input: false, returned: false },
    },
  },

  // Rate limits key on the client IP. Behind Render, set CLIENT_IP_HEADER once verified (docs/deploy.md);
  // until then a forwarded list is not trusted and Better Auth falls back to a shared bucket.
  ...(clientIpHeader ? { advanced: { ipAddress: { ipAddressHeaders: [clientIpHeader] } } } : {}),

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    // Limits are per IP. A whole office may share one IP (NAT), so sign-in allows a burst;
    // brute force on one account is stopped by the per-account lockout in the hooks below.
    customRules: {
      "/sign-in/email": { window: 60, max: 30 },
      "/two-factor/verify-totp": { window: 60, max: 10 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Endpoints the browser must never call directly. The app calls the ones it needs
      // (admin user management, change password) from server code via auth.api, where
      // there is no incoming request — so role, onboarding and audit rules always apply.
      if (ctx.request && isBlockedOverHttp(ctx.path)) {
        throw new APIError("FORBIDDEN", { code: "ENDPOINT_NOT_AVAILABLE", message: "Not available" });
      }

      if (ctx.path !== "/sign-in/email") return;
      const email = normalizeEmail(ctx.body?.email);
      if (!email) return;
      const { exists, attempt } = await reserveAttempt(email);
      if (!exists) return; // unknown email: Better Auth answers "invalid email or password"
      if (attempt === null) {
        throw new APIError("FORBIDDEN", { code: ACCOUNT_LOCKED, message: "Account is temporarily locked" });
      }
      if (attempt > MAX_FAILED_LOGINS) {
        await lockAccount(email);
        throw new APIError("FORBIDDEN", { code: ACCOUNT_LOCKED, message: "Account is temporarily locked" });
      }
    }),

    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = normalizeEmail(ctx.body?.email);
      if (!email) return;
      const returned = ctx.context.returned;
      if (returned instanceof APIError) {
        if (returned.body?.code === ACCOUNT_LOCKED) return;
        // The attempt stays counted. Lock once the limit of wrong passwords is reached.
        if (returned.status === "UNAUTHORIZED") {
          const u = await prisma.user.findUnique({ where: { email }, select: { failedLoginCount: true } });
          if (u && u.failedLoginCount >= MAX_FAILED_LOGINS) await lockAccount(email);
        }
        return;
      }
      await clearAttempts(email); // correct password
    }),
  },

  plugins: [
    admin({
      ac,
      roles,
      defaultRole: "sales",
      adminRoles: ["admin"],
      bannedUserMessage: "บัญชีนี้ถูกปิดการใช้งาน / This account has been deactivated",
    }),
    twoFactor({ issuer: "Quotation JCP" }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
