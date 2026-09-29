import { api, body } from "@/lib/flow-api";
import { checkEmbedKey, issueEmbedTicket } from "@/lib/embed-store";
export async function POST(req: Request) {
  return api(async () => {
    const b = await body(req);
    checkEmbedKey(String(b.flowId), (req.headers.get("authorization") || "").replace(/^Bearer /, ""));
    return issueEmbedTicket(String(b.flowId), b.subject, b.origin);
  });
}
