import { requestApi, body } from "@/lib/flow-api";
import { enqueueRun } from "@/lib/saas-jobs";
import { notifyJob } from "@/lib/saas-queue";
export async function POST(
  req: Request,
  c: { params: Promise<{ id: string }> },
) {
  return requestApi(req, async () => {
    const b = await body(req);
      const { run, job } = await enqueueRun((await c.params).id, b.input, false, b.demo === true, b.attachments, b.conversationRunIds);
      await notifyJob(job.id);
      return Response.json(run, { status: 202 });

  });
}
