import { requestApi } from "@/lib/flow-api";
import { knowledgeSourceBody } from "@/lib/knowledge-api";
import {
  getKnowledgeBase,
  listKnowledgeSources,
  saveKnowledgeSource,
} from "@/lib/knowledge-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { id } = await context.params;
    await getKnowledgeBase(id);
    return listKnowledgeSources(id);
  });
}
export async function POST(req: Request, context: Context) {
  return requestApi(req, async () => {
    const { input, files } = await knowledgeSourceBody(req);
    return saveKnowledgeSource((await context.params).id, input, files);
  });
}
