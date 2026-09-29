import { listFlows, createFlow, createSavedFlow } from "@/lib/flow-store";
import { api, body } from "@/lib/flow-api";
import { saasEnabled } from "@/lib/tenant-context";
import { tenantApi, limitedJson } from "@/lib/saas-http";
import { listTenantFlows, createTenantFlow } from "@/lib/tenant-flows";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (saasEnabled()) return tenantApi(req, listTenantFlows);
  return api(() => listFlows());
}
export async function POST(req: Request) {
  if (saasEnabled()) return tenantApi(req, async () => {
    const input = await limitedJson(req, 300000);
    return createTenantFlow(typeof input.name === "string" ? input.name : "Novo fluxo", input.example === true, input.graph === undefined ? undefined : input);
  });
  return api(async () => {
    const b = await body(req);
    if (b.graph !== undefined) return createSavedFlow(b);
    return createFlow(
      typeof b.name === "string" ? b.name : "Novo fluxo",
      b.example === true,
    );
  });
}
