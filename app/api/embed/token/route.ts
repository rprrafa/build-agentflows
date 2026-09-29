import { body } from "@/lib/flow-api";
import { embedOwnerApi } from "@/lib/embed-http";
import { httpError } from "@/lib/saas-http";
import { currentTenant } from "@/lib/tenant-context";
import { consumeRateLimit } from "@/lib/saas-rate-limit";
import { checkEmbedKey, issueEmbedTicket } from "@/lib/embed-store";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    return embedOwnerApi(req, String(b.flowId), async () => {
      checkEmbedKey(String(b.flowId), (req.headers.get("authorization") || "").replace(/^Bearer /, ""));
      const { db, user } = currentTenant();
      await consumeRateLimit(db, `embed-ticket:user:${user.id}`, 60, 60);
      return issueEmbedTicket(String(b.flowId), b.subject, b.origin);
    });
  } catch (error) { return httpError(error); }
}
