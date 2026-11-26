// Settings a production server cannot run safely without. Checked once at start-up
// (src/instrumentation.ts) so a missing value stops the deploy instead of failing later,
// e.g. the first time someone resets a password or a scheduler call arrives.

type Env = Record<string, string | undefined>;

function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function checkProductionEnv(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const need = (key: string, ok: boolean, why: string) => { if (!ok) errors.push(`${key}: ${why}`); };

  need("DATABASE_URL", !!env.DATABASE_URL, "not set");
  need("BETTER_AUTH_SECRET", (env.BETTER_AUTH_SECRET ?? "").length >= 32, "at least 32 characters");
  const appUrl = httpsOrigin(env.APP_URL);
  need("APP_URL", !!appUrl, "an https:// address (links in emails use it)");
  const authUrl = httpsOrigin(env.BETTER_AUTH_URL);
  need("BETTER_AUTH_URL", !!authUrl, "an https:// address");
  if (appUrl && authUrl && appUrl !== authUrl) errors.push("BETTER_AUTH_URL: must be the same site as APP_URL");
  need("STORAGE_DIR", !!env.STORAGE_DIR && /^(\/|[A-Za-z]:[\\/])/.test(env.STORAGE_DIR), "an absolute path on the persistent disk");
  if (env.RENDER && env.STORAGE_DIR && !env.STORAGE_DIR.startsWith("/var/data/")) {
    errors.push("STORAGE_DIR: on Render it must be on the disk mounted at /var/data");
  }
  need("RESEND_API_KEY", !!env.RESEND_API_KEY, "not set (mail cannot be sent)");
  need("MAIL_FROM", /<[^<>\s]+@[^<>\s]+>|^[^<>\s]+@[^<>\s]+$/.test(env.MAIL_FROM ?? ""), "a sender such as \"Quotation JCP\" <no-reply@example.com>");
  need("CRON_SECRET", (env.CRON_SECRET ?? "").length >= 32, "at least 32 characters (scheduled jobs are off without it)");

  if (!env.CLIENT_IP_HEADER) {
    warnings.push("CLIENT_IP_HEADER is not set: sign-in rate limits share one bucket for everyone behind the proxy, and audit IPs come from X-Forwarded-For (docs/deploy.md, step 6)");
  }
  return { errors, warnings };
}
