/**
 * Full page load instead of client-side navigation. Used after sign-in / sign-out / 2FA
 * so that no client router cache from the previous identity survives (per-user data).
 */
export function hardNavigate(path: string) {
  window.location.href = path;
}
