import { requestApi } from "@/lib/flow-api";
import { knowledgeSourceBody } from "@/lib/knowledge-api";
import { enqueueKnowledge } from "@/lib/saas-jobs";
import { notifyJob } from "@/lib/saas-queue";
import {
  getKnowledgeSource,
  listKnowledgeChunks,
  saveKnowledgeSource,
} from "@/lib/knowledge-service";
import {
  removeKnowledgeSource,
} from "@/lib/knowledge-index-service";
type Context = { params: Promise<{ id: string; sourceId: string }> };
export const maxDuration = 600;
export async function GET(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, sourceId } = await context.params;
    const source = await getKnowledgeSource(id, sourceId);
    const search = new URL(req.url).searchParams;
    const page = Math.max(1, Number(search.get("page")) || 1);
    const term = (search.get("search") || "").toLowerCase();
    const chunks = (await listKnowledgeChunks(id, sourceId)).filter((c) =>
      (c.pageContent + JSON.stringify(c.metadata)).toLowerCase().includes(term),
    );
    return {
      source,
      chunks: chunks.slice((page - 1) * 20, page * 20),
      total: chunks.length,
      page,
    };
  });
}
export async function PUT(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, sourceId } = await context.params;
    const { input, files } = await knowledgeSourceBody(req);
    return saveKnowledgeSource(id, input, files, sourceId);
  });
}
export async function POST(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, sourceId } = await context.params;
    const job = await enqueueKnowledge("extract", id, sourceId); await notifyJob(job.id);
    return Response.json({ queued: true, jobId: job.id }, { status: 202 });
  });
}
export async function DELETE(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, sourceId } = await context.params;
    return removeKnowledgeSource(id, sourceId);
  });
}
