import { saasDatabase } from "../lib/saas-db.ts";
import { migrateDatabase } from "../lib/db/migrate.ts";
const db = saasDatabase();
try {
  await migrateDatabase(db);
  console.log("Migrações SaaS aplicadas.");
} finally { await db.close(); }
