import { tenantApi } from "@/lib/saas-http";
import { listTenantRuns, tenantRunPage } from "@/lib/tenant-flows";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return tenantApi(req, () => {
    const params = new URL(req.url).searchParams;
    const flowId = params.get("flowId") || undefined;
    if (params.has("page") || params.has("pageSize") || params.has("status")) return tenantRunPage({ page: Number(params.get("page") || 1), pageSize: Number(params.get("pageSize") || 20), status: params.get("status") || "all", flowId });
    return listTenantRuns(flowId);
  });
}
