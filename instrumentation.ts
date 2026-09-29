export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { saasDatabase } = await import("@/lib/saas-db");
    const { migrateDatabase } = await import("@/lib/db/migrate");
    await migrateDatabase(saasDatabase());
  }
}
