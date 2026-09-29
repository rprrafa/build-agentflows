import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Graph } from "./flow-types";
const dir = mkdtempSync(join(tmpdir(), "agentflows-attachments-"));
process.env.DATA_DIR = dir;
const { saveAttachment, resolveAttachments, attachmentContext, uploadForm, getAttachment } = await import("./attachments");
const { createFlow, saveFlow, listRuns } = await import("./flow-store");
const { imageIssues } = await import("./model-capabilities");
const { block, template } = await import("./flow-types");
const { startRun } = await import("./flow-runtime");
const { chatGPT } = await import("./chatgpt");
const { abrirBanco } = await import("./store");
const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#8075dd" } }).png().toBuffer();
const picture = () => new File([new Uint8Array(png)], "foto.png", { type: "image/png" });
test.after(() => rmSync(dir, { recursive: true, force: true }));
function flow(graph: Graph = template()) { const f = createFlow("Anexos"); return saveFlow(f.id, { name: f.name, description: "", graph }); }
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let body = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  return body + `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
test("lê texto/PDF e valida a imagem real; histórico contém só metadados", async () => {
  const f = flow();
  const doc = await saveAttachment(f.id, new File(["receita,total\nsetembro,42"], "dados.csv"));
  const image = await saveAttachment(f.id, picture());
  const document = await saveAttachment(f.id, new File([pdf("Relatorio com receita 42")], "relatorio.pdf"));
  const metadata = resolveAttachments(f.id, [doc.id, image.id, document.id]);
  assert.equal(metadata.length, 3);
  assert.ok(metadata.every((a) => !("text" in a) && !("flowId" in a)));
  const context = attachmentContext(f.id, metadata);
  assert.match(context.text, /setembro,42/);
  assert.match(context.text, /Relatorio com receita 42/);
  assert.deepEqual(context.images, [`data:image/png;base64,${png.toString("base64")}`]);
});
test("recusa conteúdo disfarçado, arquivo inválido/vazio, texto binário e limites", async () => {
  const f = flow();
  await assert.rejects(() => saveAttachment(f.id, new File(["texto"], "foto.png")), /Imagem inválida/);
  await assert.rejects(() => saveAttachment(f.id, new File(["texto"], "falso.pdf")), /PDF válido/);
  await assert.rejects(() => saveAttachment(f.id, new File([""], "vazio.txt")), /não vazio/);
  await assert.rejects(() => saveAttachment(f.id, new File(["\0dados"], "binario.txt")), /binários/);
  await assert.rejects(() => saveAttachment(f.id, new File(["x".repeat(60001)], "grande.txt")), /60 mil/);
  await assert.rejects(() => saveAttachment(f.id, new File([new Uint8Array(10 * 1024 * 1024 + 1)], "grande.png")), /10 MB/);
  await assert.rejects(() => saveAttachment(f.id, new File(["<svg/>"], "vetor.svg")), /Formato/);
  await assert.rejects(() => uploadForm(new Request("http://local", { method: "POST", body: new Uint8Array(11 * 1024 * 1024) })), /10 MB/);
});
test("anexos pertencem ao fluxo; IDs, duplicação, quantidade e texto total são validados", async () => {
  const f = flow(), other = flow();
  const a = await saveAttachment(f.id, new File(["a".repeat(60000)], "a.txt"));
  const b = await saveAttachment(f.id, new File(["b".repeat(50000)], "b.txt"));
  assert.throws(() => resolveAttachments(other.id, [a.id]), /outro fluxo/);
  assert.throws(() => resolveAttachments(f.id, ["../../app.sqlite"]), /inválido/);
  assert.throws(() => resolveAttachments(f.id, [a.id, a.id]), /diferentes/);
  assert.throws(() => resolveAttachments(f.id, Array.from({ length: 6 }, (_, i) => String(i))), /até 5/);
  assert.throws(() => resolveAttachments(f.id, [a.id, b.id]), /100 mil/);
});
test("uploads abandonados expiram sem remover arquivos usados pelo histórico", async () => {
  const f = flow();
  const unused = await saveAttachment(f.id, picture()), used = await saveAttachment(f.id, picture());
  abrirBanco().prepare("UPDATE chat_attachments SET created_at=?").run(Date.now() - 2 * 86400_000);
  abrirBanco().prepare("UPDATE chat_attachments SET used=1 WHERE id=?").run(used.id);
  await saveAttachment(f.id, picture());
  assert.throws(() => getAttachment(unused.id), /expirado/);
  assert.equal(getAttachment(used.id).id, used.id);
});
test("modelos de todos os blocos alcançáveis são checados, sem trocar modelo automaticamente", () => {
  const g = template();
  const vision = { id: "vision", name: "Visão", inputModalities: ["text", "image"], isDefault: true };
  const text = { id: "text", name: "Texto", inputModalities: ["text"] };
  assert.deepEqual(imageIssues(g, [vision]), []);
  g.nodes[1].data.config.model = "text";
  assert.match(imageIssues(g, [vision, text])[0].reason, /não aceita/);
  g.nodes[1].data.config.model = "openrouter:openrouter/auto";
  assert.match(imageIssues(g, [vision])[0].reason, /específico/);
  g.nodes[1].data.config.model = "desconhecido";
  assert.match(imageIssues(g, [vision])[0].reason, /confirmar/);
  g.nodes[1].data.config.model = "vision";
  const orphan = block("llm", "orphan", 0, 0); orphan.data.config.model = "text";
  g.nodes.push(orphan);
  assert.deepEqual(imageIssues(g, [vision, text]), []);
});
test("imagens incompatíveis param antes de efeitos externos; documentos funcionam em modelo textual", async () => {
  const bridge = chatGPT();
  bridge.account = async () => ({ account: { type: "chatgpt", email: "fixture@example.com", planType: "plus" }, login: null, error: null });
  bridge.models = async () => [{ id: "text", name: "Texto", inputModalities: ["text"], isDefault: true }];
  const g = template();
  const http = block("http", "externo", 0, 0); http.data.config.url = "https://example.com";
  g.nodes.push(http); g.edges[0].target = http.id; g.edges.push({ id: "http-ai", source: http.id, target: g.nodes[1].id });
  const f = flow(g), image = await saveAttachment(f.id, picture());
  const fetch0 = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("{}"); };
  try {
    await assert.rejects(() => startRun(f.id, "Leia", false, false, [image.id]), /não aceita imagens/);
    assert.equal(calls, 0); assert.equal(listRuns(f.id).length, 0);
  } finally { globalThis.fetch = fetch0; }
  const second = flow(), doc = await saveAttachment(second.id, new File(["Receita: 42"], "dados.txt"));
  bridge.run = async (args) => { assert.match(args.prompt, /Receita: 42/); assert.deepEqual(args.images, []); return "42"; };
  const r = await startRun(second.id, "Leia", false, false, [doc.id]);
  assert.equal(r.status, "completed"); assert.equal(r.attachments?.[0].name, "dados.txt");
  assert.doesNotMatch(JSON.stringify(r), /data:image|Receita: 42/);
  await assert.rejects(() => startRun(second.id, "Leia", false, true, [doc.id]), /execução real/);
});
test("cada agente recebe os documentos e imagens originais após a saída anterior", async () => {
  const bridge = chatGPT();
  bridge.models = async () => [{ id: "vision", name: "Visão", inputModalities: ["text", "image"], isDefault: true }];
  const g = template(), second = block("llm", "segundo", 0, 0);
  g.nodes.push(second); g.edges[1].target = second.id; g.edges.push({ id: "segundo-fim", source: second.id, target: g.nodes[2].id });
  const f = flow(g), img = await saveAttachment(f.id, picture()), doc = await saveAttachment(f.id, new File(["Receita: 42"], "dados.txt"));
  const prompts: string[] = [];
  bridge.run = async (args) => { assert.match(args.prompt, /Receita: 42/); assert.equal(args.images?.[0], `data:image/png;base64,${png.toString("base64")}`); prompts.push(args.prompt); return "Primeira análise"; };
  const r = await startRun(f.id, "Analise", false, false, [img.id, doc.id]);
  assert.equal(r.status, "completed"); assert.equal(prompts.length, 2); assert.match(prompts[1], /Primeira análise/);
});
