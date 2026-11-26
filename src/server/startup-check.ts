// Node.js only (loaded from src/instrumentation.ts). In production, refuse to start with settings that
// would leave the system half-working: no mail, no scheduled jobs, files on a disk wiped on every deploy.
// ALLOW_INCOMPLETE_ENV=1 skips the stop for a local `next start` test only; never set it on Render.
import { checkProductionEnv } from "@/server/domain/env-check";

export function startupCheck() {
  if (process.env.NODE_ENV !== "production") return;
  const { errors, warnings } = checkProductionEnv(process.env);
  for (const w of warnings) console.warn(`[config] ${w}`);
  if (errors.length === 0) return;
  for (const e of errors) console.error(`[config] ${e}`);
  if (process.env.ALLOW_INCOMPLETE_ENV === "1") {
    console.error("[config] ALLOW_INCOMPLETE_ENV=1: starting anyway (local testing only)");
    return;
  }
  // Throwing would only make Next answer 500 to every request while staying up; exit instead so the
  // deploy fails visibly in the log. With a disk, Render stops the old version first, so the site is
  // down until the setting is fixed or the deploy is rolled back (docs/deploy.md).
  console.error(`[config] production settings are incomplete: ${errors.map((e) => e.split(":")[0]).join(", ")}`);
  process.exit(1);
}
