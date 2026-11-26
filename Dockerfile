# syntax=docker/dockerfile:1
# Production image for Render (docs/deploy.md). Three stages:
#   deps   – npm ci (also runs `prisma generate`)
#   build  – next build (output: standalone)
#   runner – Node + Chromium for PDFs; the app in /app, migration/seed/check tools in /opt/tools
# After building, check: docker run --rm --entrypoint ls <image> /opt/tools/node_modules/@prisma/engines
#   (must list schema-engine-debian-openssl-3.0.x)

FROM node:24-bookworm-slim AS deps
# Prisma picks its engine by the OpenSSL it finds at install time; without it, it guesses 1.1.x.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# prisma.config.ts reads DATABASE_URL; generating the client needs no real database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Turbopack starts one worker per CPU it sees; on a builder with many CPUs and little memory
# (Docker Desktop: 20 CPUs, 2 GB) that runs out of memory, so cap the threads and the JS heap.
ENV NEXT_TELEMETRY_DISABLED=1 \
    TOKIO_WORKER_THREADS=4 \
    RAYON_NUM_THREADS=4 \
    NODE_OPTIONS=--max-old-space-size=1536 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-only-secret-not-used-at-runtime-000000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
# chromium: prints quotation PDFs (puppeteer-core). fonts-thai-tlwg: fallback only, the PDF embeds Sarabun.
# tini: forwards signals so Chromium children are reaped on shutdown.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-thai-tlwg ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=10000 \
    CHROME_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Tools for `prisma migrate deploy` (Render pre-deploy command) and the first-admin seed.
COPY --from=build /app/node_modules /opt/tools/node_modules
COPY --from=build /app/package.json /app/prisma.config.ts /opt/tools/
COPY --from=build /app/prisma /opt/tools/prisma
COPY --from=build /app/src/generated /opt/tools/src/generated
COPY deploy/db-check.mjs /opt/tools/
COPY deploy/entrypoint.sh deploy/migrate.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/migrate.sh && chown node:node /opt/tools
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
