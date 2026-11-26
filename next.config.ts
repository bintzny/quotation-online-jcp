import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Every page in this app is per-user and behind login, so Cache Components /
  // partial prefetching are left off: all data is read fresh on each request.
  reactCompiler: true,
  experimental: {
    // Excel imports and PO files (≤ 10 MB) are uploaded through server actions; the proxy
    // buffers request bodies up to its own limit, so both leave room for the form overhead.
    serverActions: { bodySizeLimit: "12mb" },
    proxyClientMaxBodySize: "12mb",
  },
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      // Scripts are left to Next's defaults; these parts need no nonce and close clickjacking,
      // <base> hijacking, plugin content and forms posting to other sites.
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
    ];
    if (process.env.NODE_ENV === "production") {
      // HTTPS only from the first visit on; no includeSubDomains, the company's other subdomains are not ours.
      security.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
    }
    return [{ source: "/:path*", headers: security }];
  },
  serverExternalPackages: ["pg", "puppeteer-core"],
  // Never ship private files in the server bundle; do ship the font the PDFs embed.
  outputFileTracingExcludes: {
    "/*": ["./storage/**/*", "./.env*", "./.dev-credentials.txt", "./tests/**/*"],
  },
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@fontsource/sarabun/files/sarabun-{thai,latin}-{400,700}-normal.woff2"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
