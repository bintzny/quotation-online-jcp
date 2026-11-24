import { describe, expect, it } from "vitest";
import { isLocked } from "@/server/domain/lockout";
import { isBlockedOverHttp } from "@/server/domain/auth-routes";

const now = new Date("2026-11-24T09:00:00+07:00");

describe("isLocked", () => {
  it("is locked only while lockedUntil is in the future", () => {
    expect(isLocked({ failedLoginCount: 0, lockedUntil: null }, now)).toBe(false);
    expect(isLocked({ failedLoginCount: 0, lockedUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(isLocked({ failedLoginCount: 0, lockedUntil: new Date(now.getTime()) }, now)).toBe(false);
  });
});

describe("isBlockedOverHttp", () => {
  it("blocks admin, profile and 2FA-disable endpoints", () => {
    for (const p of ["/admin/create-user", "/admin/set-role", "/update-user", "/change-password", "/two-factor/disable", "/sign-up/email"]) {
      expect(isBlockedOverHttp(p), p).toBe(true);
    }
  });
  it("keeps the endpoints the browser needs", () => {
    for (const p of ["/sign-in/email", "/sign-out", "/get-session", "/two-factor/enable", "/two-factor/verify-totp",
      "/two-factor/verify-backup-code", "/request-password-reset", "/reset-password"]) {
      expect(isBlockedOverHttp(p), p).toBe(false);
    }
  });
});
