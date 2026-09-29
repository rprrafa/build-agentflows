import { requestApi } from "@/lib/flow-api";
import { cleanupKnowledge } from "@/lib/knowledge-index-service";
import { withKnowledgeLock } from "@/lib/knowledge-service";
import { enqueueKnowledge } from "@/lib/saas-jobs";
import { notifyJob } from "@/lib/saas-queue";
type Context = { params: Promise<{ id: string }> };
export const maxDuration = 600;
export async function POST(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id } = await context.params;
    const job = await enqueueKnowledge("index", id); await notifyJob(job.id);
    return Response.json({ queued: true, jobId: job.id }, { status: 202 });
  });
}
export async function DELETE(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id } = await context.params;
    return withKnowledgeLock(id, () => cleanupKnowledge(id));
  });
}
