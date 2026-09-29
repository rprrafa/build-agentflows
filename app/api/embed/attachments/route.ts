import { embedApi } from "@/lib/embed-http";
import { ownedSession, updateSession } from "@/lib/embed-store";
import { saveAttachment, uploadForm } from "@/lib/attachment-service";
import { FlowError } from "@/lib/flow-store";
import { consumeRateLimit } from "@/lib/saas-rate-limit";
import { currentTenant } from "@/lib/tenant-context";
export async function POST(req: Request) {
  return embedApi(req, async identity => {
    const { db, user } = currentTenant();
    await consumeRateLimit(db, `embed-upload:user:${user.id}`, 20, 60);
    const form = await uploadForm(req), session = await ownedSession(String(form.get("sessionId")), identity);
    if (session.attachments.length >= 50) throw new FlowError("Limite de anexos desta conversa atingido.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new FlowError("Escolha um arquivo.");
    const attachment = await saveAttachment(session.flowId, file);
    await updateSession(session.id, latest => {
      if (latest.attachments.length >= 50) throw new FlowError("Limite de anexos desta conversa atingido.");
      latest.attachments.push(attachment.id);
    });
    return attachment;
  });
}
