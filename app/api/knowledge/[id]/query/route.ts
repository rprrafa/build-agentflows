import { requestApi, body } from "@/lib/flow-api";
import { queryKnowledge } from "@/lib/knowledge-index-service";
type Context = { params: Promise<{ id: string }> };
export async function POST(req: Request, context: Context) {
  return requestApi(req, async () => {
    const input = await body(req);
    return queryKnowledge(
      (await context.params).id,
      input.query,
      input.topK,
      input.minScore,
      req.signal,
    );
  });
}
