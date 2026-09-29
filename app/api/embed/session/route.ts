import { body } from "@/lib/flow-api";
import { embedApi } from "@/lib/embed-http";
import { connectSession, ownedSession, updateSession, settleCommand } from "@/lib/embed-store";
import { decideEmbedRun, heartbeat, sendEmbedMessage, sessionSnapshot } from "@/lib/embed-runtime";
import { FlowError } from "@/lib/flow-store";
export async function GET(req: Request) {
  return embedApi(req, async (identity) => { const id = new URL(req.url).searchParams.get("id") || ""; await ownedSession(id, identity); return sessionSnapshot(id); });
}
export async function POST(req: Request) {
  return embedApi(req, async (i) => {
    const b = await body(req);
    if (b.action === "connect") {
      if (b.origin !== i.origin) throw new FlowError("Site não autorizado.", 403);
      const s = await connectSession(i, b.sessionId, b.tabId, b.capabilities);
      return sessionSnapshot(s.id);
    }
    const s = await ownedSession(String(b.sessionId), i);
    if (b.action === "heartbeat") { await heartbeat(s.id); return { ok: true }; }
    if (b.action === "message") return sendEmbedMessage(s.id, i, b.input, b.requestId, b.attachments || []);
    if (b.action === "decision") { await decideEmbedRun(s.id, String(b.runId), b.decision); return { ok: true }; }
    if (b.action === "claim" || b.action === "result") return settleCommand(s.id, String(b.commandId), b.action, b.result, b.success !== false);
    if (b.action === "event") {
      if (typeof b.name !== "string" || !["page.contextChanged", "page.errorReported", "page.attachmentShared"].includes(b.name)) throw new FlowError("Evento não reconhecido.");
      const text = JSON.stringify({ name: b.name, data: b.data });
      if (text.length > 8000) throw new FlowError("O contexto da página excedeu o limite.");
      await updateSession(s.id, session => { session.context = (session.context + "\n" + text).slice(-16000); });
      return { ok: true };
    }
    throw new FlowError("Ação não reconhecida.");
  });
}
