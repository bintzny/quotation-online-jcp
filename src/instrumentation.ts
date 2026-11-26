// Runs once when the server starts (see src/server/startup-check.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupCheck } = await import("@/server/startup-check");
    startupCheck();
  }
}
