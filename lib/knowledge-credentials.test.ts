import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
const dir = mkdtempSync(join(tmpdir(), "knowledge-credentials-"));
process.env.DATA_DIR = dir;
const store = await import("./knowledge-store"),
  creds = await import("./tool-credential-store"),
  runtime = await import("./knowledge-index");
const { DEFAULT_INDEX, DEFAULT_SPLITTER } = await import("./knowledge-types");
const { getConfig, setConfig } = await import("./store");
const { GET } = await import("../app/api/tool-credentials/route");
const authorization: string[] = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  authorization.push(req.headers.authorization || "");
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      data: body.input.map((_text: string, index: number) => ({
        index,
        embedding: [1, 0, 0],
      })),
    }),
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
test.after(() => {
  server.close();
  server.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});
const credential = (name: string) =>
  creds.saveToolCredential({
    name,
    provider: "embedding_openai",
    fields: { EMBEDDING_OPENAI_KEY: "key-original", EMBEDDING_OPENAI_URL: url },
  });
test("os quatro provedores guardam chaves cifradas, URLs e resumos sem segredos", () => {
  for (const provider of ["openai", "gemini", "voyage", "ollama"] as const) {
    const key = `EMBEDDING_${provider.toUpperCase()}_KEY`;
    const c = creds.saveToolCredential({
      name: provider,
      provider: `embedding_${provider}`,
      fields: provider === "ollama" ? {} : { [key]: `secret-${provider}` },
    });
    assert.equal(c.configured, true);
    assert.equal(JSON.stringify(c).includes(`secret-${provider}`), false);
    const raw = store
      .knowledgeDb()
      .prepare("SELECT valor FROM config WHERE chave=?")
      .get(`TOOL_ACCOUNT_${c.id}`) as { valor: string };
    assert.match(raw.valor, /^v1:/);
    const resolved = creds.resolveEmbeddingCredential(c.id, provider);
    assert.ok(resolved.url.startsWith("http"));
    assert.equal(
      resolved.apiKey,
      provider === "ollama" ? undefined : `secret-${provider}`,
    );
  }
});
test("uma credencial atende duas bases, gira a chave na execução e não pode ser excluída enquanto vinculada", async () => {
  const c = credential("Compartilhada");
  const bases = [
    store.createKnowledgeBase({ name: "Equipe A" }),
    store.createKnowledgeBase({ name: "Equipe B" }),
  ];
  for (const b of bases) {
    const configured = store.updateKnowledgeBase(b.id, {
      config: {
        ...structuredClone(DEFAULT_INDEX),
        embeddings: {
          provider: "openai",
          model: "fixture",
          url,
          credentialId: c.id,
        },
      },
    });
    assert.equal(configured.config.embeddings.apiKey, undefined);
    assert.equal(store.getKnowledgeSecrets(b.id).embeddingKey, undefined);
    const source = store.saveKnowledgeSource(b.id, {
      name: "Manual",
      loader: "plain",
      config: { text: "Política de entrega." },
      splitter: DEFAULT_SPLITTER,
      metadata: {},
    });
    await runtime.processKnowledgeSource(b.id, source.id);
    await runtime.indexKnowledge(b.id);
  }
  assert.throws(() => creds.deleteToolCredential(c.id), /base de conhecimento/);
  creds.saveToolCredential(
    { name: c.name, fields: { EMBEDDING_OPENAI_KEY: "key-rotated" } },
    c.id,
  );
  for (const b of bases) {
    assert.equal((await runtime.queryKnowledge(b.id, "entrega")).length, 1);
    assert.equal(authorization.at(-1), "Bearer key-rotated");
  }
  for (const b of bases) await runtime.deleteKnowledgeBase(b.id);
  creds.deleteToolCredential(c.id);
  assert.throws(() => creds.getToolCredential(c.id), /não existe/);
});
test("credencial de outro provedor, destino divergente e mudança de endpoint exigem correção explícita", () => {
  const b = store.createKnowledgeBase({ name: "Validação" }),
    c = credential("Validação");
  const config = {
    ...structuredClone(DEFAULT_INDEX),
    embeddings: {
      provider: "openai" as const,
      model: "fixture",
      url,
      credentialId: c.id,
    },
  };
  assert.throws(
    () =>
      store.updateKnowledgeBase(b.id, {
        config: {
          ...config,
          embeddings: { ...config.embeddings, provider: "gemini" },
        },
      }),
    /não pertence/,
  );
  assert.throws(
    () =>
      store.updateKnowledgeBase(b.id, {
        config: {
          ...config,
          embeddings: { ...config.embeddings, url: "https://other.example" },
        },
      }),
    /endereço/,
  );
  store.updateKnowledgeBase(b.id, { config });
  creds.saveToolCredential(
    {
      name: c.name,
      fields: { EMBEDDING_OPENAI_URL: "https://other.example/v1" },
    },
    c.id,
  );
  assert.throws(
    () => store.indexKnowledgeConfig(b.id),
    /endereço da credencial foi alterado/,
  );
  assert.throws(
    () =>
      creds.saveToolCredential({
        name: "URL inválida",
        provider: "embedding_openai",
        fields: {
          EMBEDDING_OPENAI_KEY: "secret",
          EMBEDDING_OPENAI_URL: "https://user:password@example.com",
        },
      }),
    /sem credenciais/,
  );
});
test("migração de chaves existentes é idempotente, preserva revisão e outros segredos e aparece na API de credenciais", async () => {
  const b = store.createKnowledgeBase({ name: "Base anterior" });
  b.config.embeddings = {
    provider: "openai",
    model: "fixture",
    url,
    configured: true,
  };
  b.revision = 7;
  store.saveKnowledgeBaseRecord(b);
  setConfig(
    `KNOWLEDGE_${b.id}`,
    JSON.stringify({ embeddingKey: "legacy-key", vectorKey: "vector-secret" }),
  );
  const before = creds.listToolCredentials().length;
  assert.throws(() => store.updateKnowledgeBase(b.id, { name: "" }), /nome/);
  assert.equal(creds.listToolCredentials().length, before);
  const persisted = store.knowledgeDb().prepare("SELECT body FROM knowledge_bases WHERE id=?").get(b.id) as { body: string };
  assert.equal(JSON.parse(persisted.body).config.embeddings.credentialId, undefined);
  assert.equal(JSON.parse(getConfig(`KNOWLEDGE_${b.id}`)!).embeddingKey, "legacy-key");
  const response = await GET(
    new Request("http://localhost/api/tool-credentials"),
  );
  assert.equal(response.status, 200);
  const listed = await response.json();
  const migrated = store.getKnowledgeBase(b.id);
  assert.equal(migrated.revision, 7);
  assert.ok(migrated.config.embeddings.credentialId);
  assert.ok(
    listed.some(
      (c: { id: string }) => c.id === migrated.config.embeddings.credentialId,
    ),
  );
  assert.equal(JSON.stringify(listed).includes("legacy-key"), false);
  assert.equal(
    store.indexKnowledgeConfig(b.id).embeddings.apiKey,
    "legacy-key",
  );
  assert.deepEqual(JSON.parse(getConfig(`KNOWLEDGE_${b.id}`)!), {
    vectorKey: "vector-secret",
  });
  store.migrateKnowledgeCredentials();
  store.getKnowledgeBase(b.id);
  assert.equal(creds.listToolCredentials().length, before + 1);
});
test("a fonte de upload recebe o nome exato do primeiro arquivo, inclusive nomes longos e substituições", () => {
  const b = store.createKnowledgeBase({ name: "Arquivos" });
  const name = `${"documento".repeat(15)}.txt`;
  const input = {
    name: "não deve ser usado",
    loader: "text",
    config: {},
    splitter: DEFAULT_SPLITTER,
    metadata: {},
  };
  const source = store.saveKnowledgeSource(b.id, input, [
    { name, data: Buffer.from("Documento").toString("base64") },
  ]);
  assert.equal(source.name, name);
  assert.equal(
    store.saveKnowledgeSource(b.id, input, undefined, source.id).name,
    name,
  );
  assert.equal(
    store.saveKnowledgeSource(
      b.id,
      input,
      [
        {
          name: "Novo.txt",
          data: Buffer.from("Atualizado").toString("base64"),
        },
      ],
      source.id,
    ).name,
    "Novo.txt",
  );
});
