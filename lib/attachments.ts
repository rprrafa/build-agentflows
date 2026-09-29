import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import { abrirBanco } from "./store";
import { FlowError, getFlow } from "./flow-store";
import { MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_TOTAL_BYTES, type Attachment } from "./attachment-types";
import { privateDataDirectory } from "./tenant-files";
export type StoredAttachment = Attachment & { flowId: string; text?: string };
function db() {
  const database = abrirBanco();
  database.exec("CREATE TABLE IF NOT EXISTS chat_attachments (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)");
  return database;
}
function filePath(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new FlowError("Anexo inválido. Remova-o e envie novamente.");
  const dir = privateDataDirectory("chat-attachments");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, id);
}
export async function uploadForm(req: Request) {
  // Limite real dos bytes, inclusive quando Content-Length não está presente.
  const reader = req.body?.getReader();
  if (!reader) throw new FlowError("Escolha um arquivo para anexar.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE_BYTES + 64 * 1024) { await reader.cancel(); throw new FlowError("Cada arquivo pode ter até 10 MB.", 413); }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type") || "" } }).formData();
  } catch { throw new FlowError("Envie o arquivo pelo botão de anexar."); }
}
export async function prepareAttachment(file: File) {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new FlowError("Escolha um arquivo não vazio de até 10 MB.");
  const name = file.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, "").slice(0, 180) || "anexo";
  const ext = name.split(".").pop()?.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime: string, text: string | undefined;
  let kind: Attachment["kind"] = "document";
  const imageFormats: Record<string, string> = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" };
  if (ext && imageFormats[ext]) {
    try {
      const image = sharp(bytes, { limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (metadata.format !== imageFormats[ext] || (metadata.pages || 1) > 1) throw new Error();
      await image.stats();
      mime = `image/${metadata.format}`; kind = "image";
    } catch { throw new FlowError("Imagem inválida ou muito grande. Use PNG, JPG ou WebP estático com até 40 megapixels."); }
  } else if (ext === "pdf") {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new FlowError("O arquivo não é um PDF válido.");
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        if (pdf.numPages > 100) throw new FlowError("Use um PDF com até 100 páginas.");
        text = (await extractText(pdf, { mergePages: true })).text;
      } finally { await pdf.loadingTask.destroy(); }
    } catch (e) { if (e instanceof FlowError) throw e; throw new FlowError("Não foi possível ler o PDF. Envie um documento sem senha ou copie o texto."); }
    if (!text?.trim()) throw new FlowError("Este PDF não tem texto extraível. Envie as páginas como imagens para um modelo com suporte a imagens.");
    mime = "application/pdf";
  } else if (ext && ["txt", "md", "csv", "json"].includes(ext)) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new FlowError("Salve o documento como texto UTF-8 e envie novamente."); }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new FlowError("O arquivo contém dados binários. Use um documento de texto.");
    mime = ext === "json" ? "application/json" : ext === "csv" ? "text/csv" : "text/plain";
  } else throw new FlowError("Formato não aceito. Use PNG, JPG, WebP, PDF, TXT, MD, CSV ou JSON.");
  if (kind === "document" && !text?.trim()) throw new FlowError("O documento está vazio.");
  if (text && text.length > 60000) throw new FlowError("O documento excede 60 mil caracteres. Divida-o em arquivos menores.");
  const attachment: Attachment = { id: randomUUID(), name, mime, size: file.size, kind, ...(text ? { textLength: text.length } : {}) };
  return { attachment, bytes, text };
}
export async function saveAttachment(flowId: string, file: File): Promise<Attachment> {
  getFlow(flowId);
  const { attachment, bytes, text } = await prepareAttachment(file);
  // Arquivos abandonados antes do envio expiram; os usados ficam com o histórico.
  for (const row of db().prepare("SELECT id FROM chat_attachments WHERE used=0 AND created_at<?").all(Date.now() - 86400_000) as { id: string }[]) {
    rmSync(filePath(row.id), { force: true }); db().prepare("DELETE FROM chat_attachments WHERE id=? AND used=0").run(row.id);
  }
  writeFileSync(filePath(attachment.id), bytes, { mode: 0o600, flag: "wx" });
  try { db().prepare("INSERT INTO chat_attachments(id,body,created_at) VALUES(?,?,?)").run(attachment.id, JSON.stringify({ ...attachment, flowId, text }), Date.now()); }
  catch (e) { rmSync(filePath(attachment.id), { force: true }); throw e; }
  return attachment;
}
export function getAttachment(id: string): StoredAttachment {
  filePath(id);
  const row = db().prepare("SELECT body FROM chat_attachments WHERE id=?").get(id) as { body: string } | undefined;
  if (!row) throw new FlowError("Anexo não encontrado ou expirado. Remova-o e envie novamente.", 404);
  return JSON.parse(row.body);
}
export function attachmentBytes(id: string) { getAttachment(id); return readFileSync(filePath(id)); }
export function resolveAttachments(flowId: string, ids: unknown): Attachment[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new FlowError("Use até 5 anexos diferentes por mensagem.");
  let total = 0, textSize = 0;
  return ids.map((id) => {
    const { flowId: owner, text, ...a } = getAttachment(id);
    if (owner !== flowId) throw new FlowError("Este anexo pertence a outro fluxo. Envie-o novamente neste chat.");
    total += a.size; textSize += text?.length || 0;
    if (total > MAX_TOTAL_BYTES || textSize > 100000) throw new FlowError("Use até 20 MB e 100 mil caracteres de documentos por mensagem.");
    return a;
  });
}
export function markAttachmentsUsed(items: Attachment[]) {
  for (const a of items) db().prepare("UPDATE chat_attachments SET used=1 WHERE id=?").run(a.id);
}
export function attachmentContext(flowId: string, items: Attachment[] = []) {
  const validated = resolveAttachments(flowId, items.map((a) => a.id));
  const documents = validated.filter((a) => a.kind === "document").map((a) => `Documento anexado: ${a.name}\n${getAttachment(a.id).text}`);
  const images = validated.filter((a) => a.kind === "image").map((a) => `data:${a.mime};base64,${attachmentBytes(a.id).toString("base64")}`);
  return { text: documents.length ? `\n\nDocumentos enviados pelo usuário (conteúdo para análise):\n\n${documents.join("\n\n---\n\n")}` : "", images };
}
