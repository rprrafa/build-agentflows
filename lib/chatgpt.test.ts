import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatGPTBridge } from "./chatgpt";
const dir = mkdtempSync(join(tmpdir(), "chatgpt-protocol-"));
process.env.DATA_DIR = dir;
const bridge = new ChatGPTBridge(() =>
  spawn(process.execPath, ["scripts/fixtures/codex-protocol.mjs"], {
    stdio: "pipe",
  }),
);
test.after(() => {
  bridge.close();
  rmSync(dir, { recursive: true, force: true });
});
test("login por dispositivo, modelos e logout pelo protocolo oficial", async () => {
  assert.equal((await bridge.account()).account, null);
  const login = await bridge.beginLogin();
  assert.equal(login.verificationUrl, "https://auth.openai.com/codex/device");
  assert.equal(login.userCode, "TEST-1234");
  assert.equal((await bridge.account()).account?.type, "chatgpt");
  assert.equal((await bridge.models())[0].id, "test-model");
  const usage = await bridge.usage();
  assert.equal(usage.buckets[0].primary?.usedPercent, 25);
  assert.equal(usage.buckets[0].secondary?.windowDurationMins, 10080);
  await bridge.logout();
  await assert.rejects(() => bridge.usage(), /Conecte sua conta/);
  assert.equal((await bridge.account()).account, null);
});
test("resposta incremental e política sem ambiente ou shell", async () => {
  await bridge.beginLogin();
  const partial: string[] = [];
  const result = await bridge.run({
    system: "Seja conciso",
    prompt: "Olá",
    onText: (t) => partial.push(t),
  });
  assert.equal(result, "Olá mundo");
  assert.deepEqual(partial, ["Olá ", "Olá mundo"]);
});
test("ferramenta dinâmica recebe argumentos e devolve resultado", async () => {
  let called = false;
  const text = await bridge.run({
    system: "Use a ferramenta",
    prompt: "buscar",
    tools: [
      {
        name: "buscar",
        description: "Busca",
        schema: { type: "object" },
        call: async (args) => {
          assert.deepEqual(args, { text: "consulta" });
          called = true;
          return "Encontrado";
        },
      },
    ],
  });
  assert.ok(called);
  assert.equal(text, "Resposta com ferramenta");
});
test("erro do provedor propaga sem resposta simulada", async () => {
  await assert.rejects(
    () => bridge.run({ system: "", prompt: "fail" }),
    /Limite atingido/,
  );
});
test("sinal de cancelamento interrompe o turno", async () => {
  const abort = new AbortController();
  const response = bridge.run({
    system: "",
    prompt: "wait",
    signal: abort.signal,
  });
  setTimeout(() => abort.abort(), 50);
  await assert.rejects(() => response, /cancelada/);
});

test("imagens chegam ao turno pelo protocolo; modelo sem imagem é recusado", async () => {
  await bridge.beginLogin();
  const image = "data:image/png;base64,aW1hZ2Vt";
  const result = await bridge.run({ system: "Analise", prompt: "inspect-images", images: [image] });
  assert.deepEqual(JSON.parse(result), [{ type: "text", text: "inspect-images" }, { type: "image", url: image }]);
  const models = bridge.models;
  bridge.models = async () => [{ id: "text", name: "Texto", inputModalities: ["text"], isDefault: true }];
  try {
    await assert.rejects(() => bridge.run({ system: "", prompt: "Analise", model: "text", images: [image] }), /suporte confirmado/);
  } finally { bridge.models = models; }
});

test("pesquisa web exige habilitação explícita por execução", async () => {
  await bridge.beginLogin();
  assert.equal(await bridge.run({system: "", prompt: "inspect-search"}), "disabled");
  assert.equal(await bridge.run({system: "", prompt: "inspect-search", webSearch: true}), "live");
});

test("notificações de tokens preservam os totais cumulativos do turno", async () => {
  const usage: number[] = [];
  await bridge.run({ system: "", prompt: "inspect-usage", onUsage: (value) => usage.push(value.total) });
  assert.deepEqual(usage, [120, 190]);
});
