// Account lockout rule: after MAX_FAILED_LOGINS wrong passwords in a row the account is
// locked for LOCK_MINUTES. The counting itself is done atomically in SQL (see server/auth.ts).

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export type LockState = { failedLoginCount: number; lockedUntil: Date | null };

export function isLocked(state: LockState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}
