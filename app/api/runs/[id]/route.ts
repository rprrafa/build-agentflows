import { getRun } from "@/lib/flow-store";
import { resumeRun, cancelRun } from "@/lib/flow-runtime";
import { api, requestApi, body } from "@/lib/flow-api";
import { saasEnabled, tenantId } from "@/lib/tenant-context";
import { enqueueResume } from "@/lib/saas-jobs";
import { notifyJob } from "@/lib/saas-queue";
import { tenantApi } from "@/lib/saas-http";
import { getTenantRun } from "@/lib/tenant-flows";
type C = { params: Promise<{ id: string }> };
export async function GET(req: Request, c: C) {
  if (saasEnabled()) return tenantApi(req, async () => getTenantRun((await c.params).id));
  return api(async () => getRun((await c.params).id));
}
export async function POST(req: Request, c: C) {
  return requestApi(req, async () => {
    const b = await body(req);
    if (tenantId() && b.action !== "cancel") {
      const { run, job } = await enqueueResume((await c.params).id, b.decision);
      await notifyJob(job.id);
      return Response.json(run, { status: 202 });
    }
    return b.action === "cancel"
      ? cancelRun((await c.params).id)
      : resumeRun((await c.params).id, b.decision);
  });
}
