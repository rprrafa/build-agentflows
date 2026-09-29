import { api } from "@/lib/flow-api";
import { authenticateEmbed, ownedSession } from "@/lib/embed-store";
import { attachmentBytes, getAttachment } from "@/lib/attachment-service";
import { FlowError } from "@/lib/flow-store";
export async function GET(req: Request, c: { params: Promise<{id:string}> }) {
  try {
    const i = authenticateEmbed(req), s = ownedSession(new URL(req.url).searchParams.get("sessionId") || "", i), { id } = await c.params;
    if (!s.attachments.includes(id)) throw new FlowError("Anexo não encontrado.", 404);
    const a = await getAttachment(id);
    return new Response(new Uint8Array(await attachmentBytes(id)), { headers: { "Content-Type": a.mime, "Content-Disposition": "attachment", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return api(() => { throw e; }); }
}
