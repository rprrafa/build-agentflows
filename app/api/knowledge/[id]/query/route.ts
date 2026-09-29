import { requestApi, body } from "@/lib/flow-api";
import { queryKnowledge } from "@/lib/knowledge-index-service";
import { FlowError } from "@/lib/flow-store";
type Context = { params: Promise<{ id: string }> };
export async function POST(req: Request, context: Context) {
  return requestApi(req, async () => {
    const input = await body(req);
    if (typeof input.query !== "string" || (input.topK !== undefined && typeof input.topK !== "number") || (input.minScore !== undefined && typeof input.minScore !== "number")) throw new FlowError("Informe uma consulta e limites numéricos válidos.");
    return queryKnowledge(
      (await context.params).id,
      input.query,
      input.topK,
      input.minScore,
      req.signal,
    );
  });
}
