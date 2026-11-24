// Better Auth endpoints that browsers may NOT call over HTTP.
// The app only uses these from server code (auth.api), wrapped in its own role checks,
// onboarding gates and audit log. Everything else the browser needs (sign-in/out,
// get-session, 2FA enable/verify, password reset by email) stays available.

const BLOCKED_PREFIXES = ["/admin/"];

const BLOCKED_PATHS = new Set([
  "/update-user", // would let a user rename themselves (name shows on quotations)
  "/change-password", // must go through the app action (clears mustChangePassword, audit)
  "/change-email",
  "/delete-user",
  "/set-password",
  "/two-factor/disable", // executive/admin must keep 2FA; nobody has a UI for it
  "/sign-up/email",
]);

export function isBlockedOverHttp(path: string): boolean {
  return BLOCKED_PATHS.has(path) || BLOCKED_PREFIXES.some((p) => path.startsWith(p));
}
