// Isolated integration checks. Requires disposable Postgres+pgvector; Chroma is optional.
// KNOWLEDGE_TEST_POSTGRES=... KNOWLEDGE_TEST_CHROMA=... node --import ./scripts/gancho-ts.mjs scripts/verify-knowledge-services.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "pg";
const postgres = process.env.KNOWLEDGE_TEST_POSTGRES,
  chroma = process.env.KNOWLEDGE_TEST_CHROMA;
assert.ok(
  postgres,
  "Forneça um Postgres descartável por KNOWLEDGE_TEST_POSTGRES; KNOWLEDGE_TEST_CHROMA é opcional.",
);
const dir = mkdtempSync(join(tmpdir(), "knowledge-services-"));
process.env.DATA_DIR = dir;
const store = await import("../lib/knowledge-store.ts"),
  runtime = await import("../lib/knowledge-index.ts");
const { DEFAULT_INDEX, DEFAULT_SPLITTER } =
  await import("../lib/knowledge-types.ts");
let embeddings = 0;
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  embeddings += body.input.length;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      data: body.input.map((text, index) => ({
        index,
        embedding: [
          Number(text.includes("reembolso")),
          Number(text.includes("entrega")),
          0.1,
        ],
      })),
    }),
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}/v1`;
const db = new Client({ connectionString: postgres });
await db.connect();
await db.query("CREATE EXTENSION IF NOT EXISTS vector");
const created = [];
try {
  const { supabaseSetupSql } = await import("../lib/knowledge-supabase-setup.ts");
  await db.query(supabaseSetupSql(3, { tableName: "knowledge_test_supabase", queryName: "knowledge_test_match" }));
  await db.query(`INSERT INTO knowledge_test_supabase VALUES ('a','reembolso','{"baseId":"a"}','[1,0,0]'),('b','entrega','{"baseId":"b"}','[0,1,0]')`);
  const match = await db.query(`SELECT * FROM knowledge_test_match('[1,0,0]',4,'{"baseId":"a"}')`);
  assert.equal(match.rows.length, 1);
  assert.equal(match.rows[0].id, "a");
  assert.equal(match.rows[0].similarity, 1);
  console.log("Supabase: SQL de preparação executado no pgvector; busca e filtro por base aprovados.");
  for (const provider of ["postgres", ...(chroma ? ["chroma"] : [])]) {
    const base = store.createKnowledgeBase({ name: `Integração ${provider}` });
    created.push(base.id);
    store.updateKnowledgeBase(base.id, {
      config: {
        ...structuredClone(DEFAULT_INDEX),
        embeddings: {
          provider: "openai",
          model: "test",
          url,
          apiKey: "fixture",
        },
        vectorStore:
          provider === "postgres"
            ? { provider, url: "", connectionString: postgres }
            : { provider, url: chroma },
        recordManager: {
          provider: "postgres",
          connectionString: postgres,
          tableName: "knowledge_test_records",
          namespace: "integration",
        },
      },
    });
    const source = store.saveKnowledgeSource(base.id, {
      name: "Políticas",
      loader: "plain",
      config: { text: "Política de reembolso em 7 dias. Entrega nacional." },
      splitter: DEFAULT_SPLITTER,
      metadata: { area: "atendimento" },
    });
    await runtime.processKnowledgeSource(base.id, source.id);
    const before = embeddings,
      first = await runtime.indexKnowledge(base.id);
    assert.equal(first.base.status, "ready");
    assert.equal(first.run.embedded, 1);
    assert.equal(embeddings, before + 1);
    const hits = await runtime.queryKnowledge(base.id, "reembolso");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].metadata.area, "atendimento");
    const second = await runtime.indexKnowledge(base.id);
    assert.equal(second.run.embedded, 0);
    assert.equal(second.run.reused, 1);
    const recordCount = await db.query(
      "SELECT count(*),count(distinct generation) as generations FROM knowledge_test_records WHERE base_id=$1",
      [base.id],
    );
    assert.equal(Number(recordCount.rows[0].count), 1);
    assert.equal(Number(recordCount.rows[0].generations), 1);
    await runtime.removeKnowledgeSource(base.id, source.id);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM knowledge_test_records WHERE base_id=$1",
            [base.id],
          )
        ).rows[0].count,
      ),
      0,
    );
    await runtime.deleteKnowledgeBase(base.id);
    assert.equal(
      store
        .knowledgeDb()
        .prepare("SELECT count(*) as n FROM knowledge_cleanup WHERE base_id=?")
        .get(base.id).n,
      0,
    );
    console.log(
      `${provider}: indexação, consulta, reuso no Postgres Record Manager, limpeza da versão anterior e exclusão da fonte/base aprovados.`,
    );
  }
} finally {
  for (const id of created) {
    try {
      store.getKnowledgeBase(id);
      await runtime.deleteKnowledgeBase(id);
    } catch {}
  }
  await db.query("DROP TABLE IF EXISTS knowledge_test_records");
  await db.query("DROP FUNCTION IF EXISTS knowledge_test_match(vector, int, jsonb)");
  await db.query("DROP TABLE IF EXISTS knowledge_test_supabase");
  await db.end();
  server.close();
  server.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
}
