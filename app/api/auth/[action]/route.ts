import { authAction } from "@/lib/saas-http";
import { saasDatabase } from "@/lib/saas-db";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
async function handle(req: Request, context: Context) {
  return authAction(saasDatabase(), req, (await context.params).action);
}
export const GET = handle;
export const POST = handle;
