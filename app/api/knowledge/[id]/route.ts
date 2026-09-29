import { requestApi, body } from "@/lib/flow-api";
import {
  getKnowledgeBase,
  knowledgeBaseUsages,
  listKnowledgeRuns,
  listKnowledgeSources,
  updateKnowledgeBase,
} from "@/lib/knowledge-service";
import { deleteKnowledgeBase, knowledgeStorageLocation, cleanupPending } from "@/lib/knowledge-index-service";
import { listKnowledgeJobs } from "@/lib/saas-jobs";
type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id } = await context.params;
    const base = await getKnowledgeBase(id);
    const pending = await cleanupPending(id);
    return {
      base,
      jobs: await listKnowledgeJobs(id),
      storage: await knowledgeStorageLocation(id),
      sources: await listKnowledgeSources(id),
      runs: await listKnowledgeRuns(id),
      usages: await knowledgeBaseUsages(id),
      cleanupPending: pending,
    };
  });
}
export async function PUT(req: Request, context: Context) {
  return requestApi(req, async () =>
    updateKnowledgeBase((await context.params).id, await body(req)),
  );
}
export async function DELETE(req: Request, context: Context) {
  return requestApi(req, async () => deleteKnowledgeBase((await context.params).id));
}
