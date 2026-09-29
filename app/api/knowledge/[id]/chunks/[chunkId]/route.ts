import { requestApi, body } from "@/lib/flow-api";
import { editKnowledgeChunk } from "@/lib/knowledge-service";
type Context = { params: Promise<{ id: string; chunkId: string }> };
export async function PUT(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, chunkId } = await context.params;
    const input = await body(req);
    await editKnowledgeChunk(id, chunkId, {
      pageContent: input.pageContent,
      metadata: input.metadata,
    });
    return { ok: true };
  });
}
export async function DELETE(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, chunkId } = await context.params;
    await editKnowledgeChunk(id, chunkId, null);
    return { ok: true };
  });
}
