import { api, body } from "@/lib/flow-api";
import { embedSecurity, saveEmbedSecurity } from "@/lib/embed-security";
import { FlowError } from "@/lib/flow-store";
export const dynamic = "force-dynamic";
export async function GET() { return api(() => embedSecurity()); }
export async function PUT(req: Request) {
  return api(async () => {
    const b = await body(req);
    try { return saveEmbedSecurity(b.origins); }
    catch (e) { throw new FlowError(e instanceof Error ? e.message : "Confira os sites autorizados."); }
  });
}
