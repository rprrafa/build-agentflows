import { saasDatabase } from "@/lib/saas-db";

export async function GET() {
  try {
    if (process.env.DATABASE_URL) await saasDatabase().query("SELECT 1");
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
