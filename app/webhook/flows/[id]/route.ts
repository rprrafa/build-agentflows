import { integrationApi } from "@/lib/mcp";
import { enqueueIntegrationRun, executionSummary, integrationId } from "@/lib/ferramentas";
import { body } from "@/lib/flow-api";
import { privateJson } from "@/lib/saas-http";
import { getTenantFlow, getTenantRun } from "@/lib/tenant-flows";
import { FlowError } from "@/lib/flow-store";
type Context = { params: Promise<{ id: string }> };
export async function POST(req: Request, c: Context) {
  return integrationApi(req, async () => {
    const b = await body(req);
    return privateJson(await enqueueIntegrationRun((await c.params).id, b.input), { status: 202 });
  });
}
export async function GET(req: Request, c: Context) {
  return integrationApi(req, async () => {
    const flow = await getTenantFlow(integrationId((await c.params).id));
    const run = await getTenantRun(integrationId(new URL(req.url).searchParams.get("runId")));
    if (run.flowId !== flow.id) throw new FlowError("Execução não encontrada.", 404);
    return executionSummary(run);
  });
}
