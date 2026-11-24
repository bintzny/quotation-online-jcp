// Maps Better Auth error responses to translation keys under "auth.errors".

type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

export type AuthErrorKey =
  | "invalidCredentials"
  | "accountLocked"
  | "banned"
  | "tooManyRequests"
  | "invalidCode"
  | "invalidToken"
  | "wrongCurrentPassword"
  | "twoFactorExpired";

export function authErrorKey(error: AuthError): AuthErrorKey | null {
  if (!error) return null;
  if (error.status === 429) return "tooManyRequests";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "invalidCredentials";
    case "ACCOUNT_LOCKED":
      return "accountLocked";
    case "BANNED_USER":
      return "banned";
    case "INVALID_CODE":
    case "INVALID_TWO_FACTOR_CODE":
    case "INVALID_BACKUP_CODE":
    case "OTP_HAS_EXPIRED":
      return "invalidCode";
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
    case "INVALID_TWO_FACTOR_COOKIE":
      return "twoFactorExpired";
    case "INVALID_TOKEN":
      return "invalidToken";
    case "INVALID_PASSWORD":
      return "wrongCurrentPassword";
    default:
      return null;
  }
}
