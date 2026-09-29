import { authAction, privateJson } from "@/lib/saas-http";
import { saasDatabase } from "@/lib/saas-db";
import { saasEnabled } from "@/lib/tenant-context";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
async function handle(req: Request, context: Context) {
  if (!saasEnabled()) return privateJson({ error: "SaaS não configurado." }, { status: 503 });
  return authAction(saasDatabase(), req, (await context.params).action);
}
export const GET = handle;
export const POST = handle;
