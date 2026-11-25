import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Every page in this app is per-user and behind login, so Cache Components /
  // partial prefetching are left off: all data is read fresh on each request.
  reactCompiler: true,
  experimental: {
    // Excel imports (customers/products) are uploaded through server actions.
    serverActions: { bodySizeLimit: "10mb" },
  },
  output: "standalone",
  serverExternalPackages: ["pg"],
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
