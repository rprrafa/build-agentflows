import { requestApi, body } from "@/lib/flow-api";
import { editKnowledgeChunk } from "@/lib/knowledge-service";
import { FlowError } from "@/lib/flow-store";
type Context = { params: Promise<{ id: string; chunkId: string }> };
export async function PUT(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id, chunkId } = await context.params;
    const input = await body(req);
    if (typeof input.pageContent !== "string" || !input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw new FlowError("Informe o texto e os metadados do fragmento.");
    await editKnowledgeChunk(id, chunkId, {
      pageContent: input.pageContent,
      metadata: input.metadata as Record<string, unknown>,
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
