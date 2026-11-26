import { isIP } from "node:net";

// Which address made a request. Anyone can send X-Forwarded-For, so its leftmost value is whatever
// the client wrote; only values added by our own proxies can be trusted.
//
//  - CLIENT_IP_HEADER set (e.g. "true-client-ip"): a single-value header that the hosting proxy
//    sets itself, replacing anything the client sent. Verify this on the real host before setting it
//    (docs/deploy.md, "ตรวจ IP ผู้ใช้").
//  - Otherwise: X-Forwarded-For counted from the right. TRUSTED_PROXY_HOPS (default 1) is how many
//    proxies in front of the app append to it; the value they appended last is the one to use.

export type IpConfig = { header: string | null; hops: number };

export function ipConfig(env: Record<string, string | undefined> = process.env): IpConfig {
  const raw = env.CLIENT_IP_HEADER?.trim().toLowerCase() || null;
  const header = raw && /^[a-z0-9-]{1,64}$/.test(raw) ? raw : null;
  const n = Number(env.TRUSTED_PROXY_HOPS);
  const hops = Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
  return { header, hops };
}

function clean(value: string | undefined): string | null {
  if (!value) return null;
  let v = value.trim();
  // "[2001:db8::1]:443" or "203.0.113.5:1234"
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) v = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  return isIP(v) ? v : null;
}

export function clientIp(get: (name: string) => string | null | undefined, cfg: IpConfig = ipConfig()): string | null {
  if (cfg.header) {
    const v = get(cfg.header);
    // A trusted single-value header never holds a list; a list means the header was not set by our proxy.
    return v && !v.includes(",") ? clean(v) : null;
  }
  const xff = get("x-forwarded-for");
  if (!xff) return null;
  const parts = xff.split(",");
  return clean(parts[parts.length - cfg.hops]);
}
