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
