import { api } from "@/lib/flow-api";
import { authenticateEmbed, ownedSession, putSession } from "@/lib/embed-store";
import { saveAttachment, uploadForm } from "@/lib/attachment-service";
import { FlowError } from "@/lib/flow-store";
export async function POST(req: Request) {
  return api(async () => {
    const identity = authenticateEmbed(req), form = await uploadForm(req);
    const s = ownedSession(String(form.get("sessionId")), identity);
    if (s.attachments.length >= 50) throw new FlowError("Limite de anexos desta conversa atingido.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new FlowError("Escolha um arquivo.");
    const a = await saveAttachment(s.flowId, file);
    const latest = ownedSession(s.id, identity); latest.attachments.push(a.id); putSession(latest);
    return a;
  });
}
