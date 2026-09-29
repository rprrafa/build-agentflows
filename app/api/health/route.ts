import { saasDatabase } from "@/lib/saas-db";

export async function GET() {
  try {
    await saasDatabase().query("SELECT 1");
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
