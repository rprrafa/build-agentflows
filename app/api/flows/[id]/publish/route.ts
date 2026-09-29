import { publishFlow } from "@/lib/flow-store";
import { api, body } from "@/lib/flow-api";
import { saasEnabled } from "@/lib/tenant-context";
import { tenantApi, limitedJson } from "@/lib/saas-http";
import { publishTenantFlow } from "@/lib/tenant-flows";
export async function POST(
  req: Request,
  c: { params: Promise<{ id: string }> },
) {
  if (saasEnabled()) return tenantApi(req, async () => publishTenantFlow((await c.params).id, (await limitedJson(req)).active !== false));
  return api(async () =>
    publishFlow((await c.params).id, (await body(req)).active !== false),
  );
}
