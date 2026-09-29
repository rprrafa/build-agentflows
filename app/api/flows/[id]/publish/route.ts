import { tenantApi, limitedJson } from "@/lib/saas-http";
import { publishTenantFlow } from "@/lib/tenant-flows";
export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return tenantApi(req, async () => publishTenantFlow((await c.params).id, (await limitedJson(req)).active !== false));
}
