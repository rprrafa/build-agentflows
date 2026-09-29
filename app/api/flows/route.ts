import { tenantApi, limitedJson } from "@/lib/saas-http";
import { listTenantFlows, createTenantFlow } from "@/lib/tenant-flows";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return tenantApi(req, listTenantFlows); }
export async function POST(req: Request) {
  return tenantApi(req, async () => {
    const input = await limitedJson(req, 300000);
    return createTenantFlow(typeof input.name === "string" ? input.name : "Novo fluxo", input.example === true, input.graph === undefined ? undefined : input);
  });
}
