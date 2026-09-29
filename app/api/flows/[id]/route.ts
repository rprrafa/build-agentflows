import { getFlow, saveFlow, deleteFlow } from "@/lib/flow-store";
import { api, body } from "@/lib/flow-api";
import { saasEnabled } from "@/lib/tenant-context";
import { tenantApi, limitedJson } from "@/lib/saas-http";
import { getTenantFlow, saveTenantFlow, deleteTenantFlow } from "@/lib/tenant-flows";
type C = { params: Promise<{ id: string }> };
export async function GET(req: Request, c: C) {
  if (saasEnabled()) return tenantApi(req, async () => getTenantFlow((await c.params).id));
  return api(async () => getFlow((await c.params).id));
}
export async function PUT(req: Request, c: C) {
  if (saasEnabled()) return tenantApi(req, async () => saveTenantFlow((await c.params).id, await limitedJson(req, 300000)));
  return api(async () => saveFlow((await c.params).id, await body(req)));
}
export async function DELETE(req: Request, c: C) {
  if (saasEnabled()) return tenantApi(req, async () => { await deleteTenantFlow((await c.params).id); return { ok: true }; });
  return api(async () => {
    deleteFlow((await c.params).id);
    return { ok: true };
  });
}
