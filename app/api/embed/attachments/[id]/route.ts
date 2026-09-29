import { embedApi } from "@/lib/embed-http";
import { ownedSession, sessionHasAttachment } from "@/lib/embed-store";
import { attachmentBytes, getAttachment } from "@/lib/attachment-service";
import { FlowError } from "@/lib/flow-store";
import { currentTenant } from "@/lib/tenant-context";
import { consumeRateLimit } from "@/lib/saas-rate-limit";
export async function GET(req: Request, c: { params: Promise<{id:string}> }) {
  return embedApi(req, async identity => {
    const { db, user } = currentTenant();
    await consumeRateLimit(db, `embed-download:user:${user.id}`, 20, 60);
    const session = await ownedSession(new URL(req.url).searchParams.get("sessionId") || "", identity), { id } = await c.params;
    if (!await sessionHasAttachment(session, id)) throw new FlowError("Anexo não encontrado.", 404);
    const attachment = await getAttachment(id);
    if (attachment.flowId !== session.flowId) throw new FlowError("Anexo não encontrado.", 404);
    return new Response(new Uint8Array(await attachmentBytes(id)), { headers: { "Content-Type": attachment.mime, "Content-Disposition": "attachment", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
