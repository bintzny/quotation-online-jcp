import { describe, expect, it } from "vitest";
import { clientIp, ipConfig } from "@/server/domain/client-ip";
import { checkProductionEnv } from "@/server/domain/env-check";

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("client IP", () => {
  it("uses the address our proxy appended, not the one the client wrote", () => {
    const get = headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" });
    expect(clientIp(get, { header: null, hops: 1 })).toBe("203.0.113.9");
    expect(clientIp(get, { header: null, hops: 2 })).toBe("1.2.3.4");
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9" }), { header: null, hops: 2 })).toBeNull();
  });
  it("a trusted single-value header wins; a list in it is rejected", () => {
    const cfg = { header: "true-client-ip", hops: 1 };
    expect(clientIp(headers({ "true-client-ip": "198.51.100.7", "x-forwarded-for": "9.9.9.9" }), cfg)).toBe("198.51.100.7");
    expect(clientIp(headers({ "true-client-ip": "1.1.1.1, 198.51.100.7" }), cfg)).toBeNull();
    expect(clientIp(headers({}), cfg)).toBeNull();
  });
  it("accepts only IP addresses, with or without a port", () => {
    const one = (v: string) => clientIp(headers({ "x-forwarded-for": v }), { header: null, hops: 1 });
    expect(one("203.0.113.9:4431")).toBe("203.0.113.9");
    expect(one("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(one("2001:db8::1")).toBe("2001:db8::1");
    expect(one("<script>")).toBeNull();
    expect(one("unknown")).toBeNull();
  });
  it("reads the settings defensively", () => {
    expect(ipConfig({})).toEqual({ header: null, hops: 1 });
    expect(ipConfig({ CLIENT_IP_HEADER: " True-Client-IP ", TRUSTED_PROXY_HOPS: "2" })).toEqual({ header: "true-client-ip", hops: 2 });
    expect(ipConfig({ CLIENT_IP_HEADER: "bad header!", TRUSTED_PROXY_HOPS: "99" })).toEqual({ header: null, hops: 1 });
  });
});

describe("production settings", () => {
  const good = {
    DATABASE_URL: "postgresql://u:p@db/q",
    BETTER_AUTH_SECRET: "x".repeat(44),
    APP_URL: "https://quotation.example.co.th",
    BETTER_AUTH_URL: "https://quotation.example.co.th/",
    STORAGE_DIR: "/var/data/storage",
    RESEND_API_KEY: "re_test",
    MAIL_FROM: "\"Quotation JCP\" <no-reply@example.co.th>",
    CRON_SECRET: "y".repeat(44),
    CLIENT_IP_HEADER: "true-client-ip",
  };
  it("a complete production configuration passes", () => {
    expect(checkProductionEnv(good)).toEqual({ errors: [], warnings: [] });
  });
  it("names each missing or unsafe setting", () => {
    const { errors } = checkProductionEnv({
      ...good, APP_URL: "http://quotation.example.co.th", STORAGE_DIR: "storage", CRON_SECRET: "short", RESEND_API_KEY: "",
    });
    const keys = errors.map((e) => e.split(":")[0]);
    expect(keys).toEqual(expect.arrayContaining(["APP_URL", "STORAGE_DIR", "CRON_SECRET", "RESEND_API_KEY"]));
    expect(checkProductionEnv({ ...good, BETTER_AUTH_URL: "https://other.example.com" }).errors[0]).toMatch(/same site/);
    expect(checkProductionEnv({ ...good, MAIL_FROM: "Quotation JCP" }).errors[0]).toMatch(/^MAIL_FROM/);
    // on Render, files outside the mounted disk vanish on every deploy
    expect(checkProductionEnv({ ...good, RENDER: "true", STORAGE_DIR: "/tmp/storage" }).errors[0]).toMatch(/^STORAGE_DIR/);
    expect(checkProductionEnv({ ...good, RENDER: "true" }).errors).toEqual([]);
  });
  it("warns until the client IP header is configured", () => {
    expect(checkProductionEnv({ ...good, CLIENT_IP_HEADER: "" }).warnings).toHaveLength(1);
  });
});
