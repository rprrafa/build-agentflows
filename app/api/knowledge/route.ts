import { requestApi, body } from "@/lib/flow-api";
import { createKnowledgeBase, listKnowledgeBases } from "@/lib/knowledge-service";
export const dynamic = "force-dynamic";
export async function GET(req?: Request) {
  return requestApi(req, () => listKnowledgeBases());
}
export async function POST(req: Request) {
  return requestApi(req, async () => createKnowledgeBase(await body(req)));
}
