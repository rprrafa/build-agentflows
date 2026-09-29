export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // SaaS startup must not open or recover the global SQLite database. Its
    // durable jobs will be recovered by the dedicated worker.
    if (process.env.DATABASE_URL) {
      const { saasDatabase } = await import("@/lib/saas-db");
      const { migrateDatabase } = await import("@/lib/db/migrate");
      await migrateDatabase(saasDatabase());
      return;
    }
    const { interruptRuns } = await import("@/lib/flow-store");
    const { recoverEmbedJobs, drainEmbedJobs } = await import("@/lib/embed-runtime");
    interruptRuns(); recoverEmbedJobs();
    const timer = setInterval(() => { void drainEmbedJobs().catch(console.error); }, 1000);
    timer.unref();
  }
}
