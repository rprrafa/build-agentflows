import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  migrations: { schema: "public", table: "__drizzle_migrations" },
  dbCredentials: { url: process.env.DATABASE_URL || "" },
  strict: true,
});
