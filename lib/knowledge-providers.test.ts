import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { embedKnowledge } from "./knowledge-embeddings";
import {
  writeVectorGeneration,
  queryVectorGeneration,
  deleteVectorGeneration,
  vectorCollection,
} from "./knowledge-vectors";
import { validatedIndexConfig } from "./knowledge-config";
import { DEFAULT_INDEX, type IndexConfig } from "./knowledge-types";
import { supabaseSetupSql } from "./knowledge-supabase-setup";
const dir = mkdtempSync(join(tmpdir(), "knowledge-providers-"));
process.env.DATA_DIR = dir;
const scope = { baseId: randomUUID(), generation: randomUUID(), dimensions: 3 };
const rows = [
  {
    id: "a".repeat(64),
    sourceId: "source-a",
    content: "Reembolso",
    metadata: { section: "billing" },
    vector: [1, 0, 0],
  },
  {
    id: "b".repeat(64),
    sourceId: "source-b",
    content: "Entrega",
    metadata: { section: "shipping" },
    vector: [0, 1, 0],
  },
];
const calls: {
  url: string;
  method: string;
  body: Record<string, unknown>;
  headers: import("node:http").IncomingHttpHeaders;
}[] = [];
let responseBody: unknown = {},
  status = 200;
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const p of req) raw += p;
  calls.push({
    url: req.url!,
    method: req.method!,
    body: raw ? JSON.parse(raw) : {},
    headers: req.headers,
  });
  res.statusCode = status;
  if (status === 204) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(responseBody));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
test.after(() => {
  server.close();
  server.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});
const config = (
  provider: IndexConfig["vectorStore"]["provider"],
): IndexConfig["vectorStore"] => ({ provider, url, apiKey: "private-key" });
function respond(body: unknown, code = 200) {
  responseBody = body;
  status = code;
  calls.length = 0;
}
test("Faiss persiste o índice nativo, consulta e remove IDs sem deslocar referências", async () => {
  const c = config("faiss");
  await writeVectorGeneration(c, scope, rows);
  assert.deepEqual(await queryVectorGeneration(c, scope, [0, 1, 0], 1), [
    rows[1].id,
  ]);
  await deleteVectorGeneration(c, scope, [rows[0].id]);
  assert.deepEqual(await queryVectorGeneration(c, scope, [0, 1, 0], 5), [
    rows[1].id,
  ]);
  await deleteVectorGeneration(c, scope);
  await assert.rejects(
    queryVectorGeneration(c, scope, [1, 0, 0], 1),
    /banco vetorial/,
  );
});
test("OpenAI respeita modelo, dimensões automáticas e preparação; Gemini e Voyage distinguem consulta de documento", async () => {
  const vector = Array(1536).fill(0);
  vector[0] = 1;
  respond({ data: [{ index: 0, embedding: vector }] });
  await embedKnowledge(
    {
      provider: "openai",
      model: "text-embedding-3-small",
      url,
      apiKey: "key",
      stripNewLines: true,
    },
    ["linha\nnova"],
  );
  assert.equal(calls[0].body.dimensions, 1536);
  assert.deepEqual(calls[0].body.input, ["linha nova"]);
  respond({ data: [{ index: 0, embedding: [1, 0, 0] }] });
  await assert.rejects(
    embedKnowledge(
      {
        provider: "openai",
        model: "text-embedding-3-small",
        url,
        apiKey: "key",
      },
      ["x"],
    ),
    /tamanho/,
  );
  for (const purpose of ["document", "query"] as const) {
    const gemini = Array(3072).fill(0);
    gemini[0] = 1;
    respond({ embeddings: [{ values: gemini }] });
    await embedKnowledge(
      {
        provider: "gemini",
        model: "gemini-embedding-001",
        url,
        apiKey: "gemini-key",
      },
      ["texto"],
      undefined,
      purpose,
    );
    assert.equal(calls[0].headers["x-goog-api-key"], "gemini-key");
    const request = (calls[0].body.requests as Record<string, unknown>[])[0];
    assert.equal(
      request.taskType,
      purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
    );
    assert.equal(request.outputDimensionality, 3072);
    respond({ embeddings: [{ values: gemini }] });
    await embedKnowledge(
      {
        provider: "gemini",
        model: "gemini-embedding-2",
        url,
        apiKey: "gemini-key",
      },
      ["texto"],
      undefined,
      purpose,
    );
    const secondRequest = (
      calls[0].body.requests as Record<string, unknown>[]
    )[0];
    assert.equal(secondRequest.taskType, undefined);
    assert.deepEqual(secondRequest.content, {
      parts: [
        {
          text:
            purpose === "query"
              ? "task: search result | query: texto"
              : "title: none | text: texto",
        },
      ],
    });
    const voyage = Array(1024).fill(0);
    voyage[0] = 1;
    respond({ data: [{ index: 0, embedding: voyage }] });
    await embedKnowledge(
      { provider: "voyage", model: "voyage-4", url, apiKey: "voyage-key" },
      ["texto"],
      undefined,
      purpose,
    );
    assert.equal(calls[0].body.input_type, purpose);
    assert.equal(calls[0].body.truncation, false);
  }
});
test("Chroma usa API v2, vetores próprios e identifica a coleção antes de consultar/remover", async () => {
  const c = config("chroma");
  respond({ id: "collection-uuid" });
  await writeVectorGeneration(c, scope, rows);
  assert.match(
    calls[0].url,
    /api\/v2\/tenants\/default_tenant\/databases\/default_database\/collections$/,
  );
  assert.deepEqual(calls[0].body.configuration, { hnsw: { space: "cosine" } });
  assert.deepEqual(
    calls[1].body.ids,
    rows.map((r) => r.id),
  );
  assert.match(calls[1].url, /collection-uuid\/upsert$/);
  respond({ id: "collection-uuid", ids: [[rows[1].id]] });
  assert.deepEqual(await queryVectorGeneration(c, scope, [0, 1, 0], 1), [
    rows[1].id,
  ]);
  assert.deepEqual(calls[1].body.query_embeddings, [[0, 1, 0]]);
  respond({ id: "collection-uuid" });
  await deleteVectorGeneration(c, scope, [rows[0].id]);
  assert.deepEqual(calls[1].body.ids, [rows[0].id]);
  respond({}, 404);
  await deleteVectorGeneration(c, scope);
});
test("Elasticsearch e OpenSearch criam mappings próprios, atualizam a visibilidade e consultam k-NN", async () => {
  for (const provider of ["elasticsearch", "opensearch"] as const) {
    const c = { ...config(provider), options: { username: "reader" } };
    respond({});
    await writeVectorGeneration(c, scope, rows);
    assert.equal(calls[0].url, `/${vectorCollection(scope)}`);
    const properties = (
      calls[0].body.mappings as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    assert.equal(
      properties.embedding.type,
      provider === "elasticsearch" ? "dense_vector" : "knn_vector",
    );
    assert.equal(calls.at(-1)!.url, `/${vectorCollection(scope)}/_refresh`);
    assert.equal(
      calls[0].headers.authorization,
      `Basic ${Buffer.from("reader:private-key").toString("base64")}`,
    );
    respond({ hits: { hits: [{ _id: rows[0].id }] } });
    assert.deepEqual(await queryVectorGeneration(c, scope, [1, 0, 0], 1), [
      rows[0].id,
    ]);
    assert.equal(calls[0].body.size, 1);
    assert.ok(
      provider === "elasticsearch" ? calls[0].body.knn : calls[0].body.query,
    );
    respond({});
    await deleteVectorGeneration(c, scope, [rows[0].id]);
    assert.match(calls[0].url, /_doc\/a+\?refresh=true$/);
  }
});
test("Pinecone valida dimensão e isola cada geração em um namespace antes de publicar", async () => {
  const c = config("pinecone");
  respond({ dimension: 12 });
  await assert.rejects(writeVectorGeneration(c, scope, rows), /incompatível/);
  assert.equal(calls.length, 1);
  const { createHash } = await import("node:crypto");
  const namespace =
    "agentflows_" +
    createHash("sha256")
      .update(`${scope.baseId}:${scope.generation}`)
      .digest("hex")
      .slice(0, 40);
  respond({ dimension: 3, namespaces: { [namespace]: { vectorCount: 2 } } });
  await writeVectorGeneration(c, scope, rows);
  assert.equal(calls[1].body.namespace, namespace);
  assert.equal(calls[1].headers["api-key"], "private-key");
  respond({ matches: [{ id: rows[0].id }] });
  assert.deepEqual(await queryVectorGeneration(c, scope, [1, 0, 0], 1), [
    rows[0].id,
  ]);
  assert.equal(calls[0].body.namespace, namespace);
  respond({});
  await deleteVectorGeneration(c, scope);
  assert.equal(calls[0].body.namespace, namespace);
  assert.equal(calls[0].body.deleteAll, true);
});
test("Weaviate usa vetores fornecidos, rejeita erros por objeto e valida erros GraphQL", async () => {
  const c = config("weaviate");
  respond([{ result: { status: "SUCCESS" } }]);
  await writeVectorGeneration(c, scope, rows);
  assert.equal(calls[0].body.vectorizer, "none");
  const name = calls[0].body.class as string;
  respond({ data: { Get: { [name]: [{ chunkId: rows[1].id }] } } });
  assert.deepEqual(await queryVectorGeneration(c, scope, [0, 1, 0], 1), [
    rows[1].id,
  ]);
  assert.match(String(calls[0].body.query), /nearVector/);
  respond({ errors: [{ message: "secret upstream" }] });
  await assert.rejects(
    queryVectorGeneration(c, scope, [0, 1, 0], 1),
    (e) => !String(e).includes("secret upstream"),
  );
  respond([{ result: { errors: { error: [{ message: "invalid vector" }] } } }]);
  await assert.rejects(writeVectorGeneration(c, scope, rows), /rejeitou/);
  respond({}, 204);
  await deleteVectorGeneration(c, scope);
  assert.equal(calls[0].method, "DELETE");
});
test("Supabase preserva metadados, evita colisão entre gerações e restringe consulta e exclusão", async () => {
  const c = {
    ...config("supabase"),
    options: { tableName: "documents", queryName: "search_documents" },
  };
  respond({}, 204);
  await writeVectorGeneration(c, scope, rows);
  const inserted = calls[0].body as unknown as {
    id: string;
    metadata: Record<string, unknown>;
  }[];
  assert.equal(inserted[0].id, `${scope.generation}_${rows[0].id}`);
  assert.equal(inserted[0].metadata.section, "billing");
  assert.equal(inserted[0].metadata.generation, scope.generation);
  respond([{ metadata: { chunkId: rows[0].id } }]);
  assert.deepEqual(await queryVectorGeneration(c, scope, [1, 0, 0], 1), [
    rows[0].id,
  ]);
  assert.deepEqual(calls[0].body.filter, {
    baseId: scope.baseId,
    generation: scope.generation,
  });
  respond({}, 204);
  await deleteVectorGeneration(c, scope, [rows[0].id]);
  const params = new URL(calls[0].url, url).searchParams;
  assert.equal(params.get("metadata->>baseId"), `eq.${scope.baseId}`);
  assert.equal(params.get("metadata->>generation"), `eq.${scope.generation}`);
  assert.match(params.get("id")!, /in\.\(/);
  assert.match(supabaseSetupSql(1536), /vector\(1536\)/);
  assert.match(supabaseSetupSql(1536), /security invoker/);
});
test("configuração cifra conexões e descarta credenciais ao trocar o destino ou provedor", () => {
  const old = structuredClone(DEFAULT_INDEX);
  old.embeddings.provider = "ollama";
  old.embeddings.url = url;
  old.vectorStore = { provider: "qdrant", url };
  const c = structuredClone(old);
  c.vectorStore = {
    provider: "postgres",
    url: "",
    connectionString: "postgresql://user:secret@localhost/database",
  };
  c.recordManager = {
    provider: "postgres",
    connectionString: "postgresql://u:private@localhost/records",
  };
  const result = validatedIndexConfig(c, old, { vectorKey: "old-key" });
  assert.equal(result.secrets.vectorKey, undefined);
  assert.doesNotMatch(JSON.stringify(result.config), /secret|private/);
  assert.match(result.secrets.recordConnection, /private/);
  assert.throws(
    () =>
      validatedIndexConfig(
        {
          ...c,
          recordManager: {
            ...c.recordManager,
            tableName: "x;DROP TABLE anything",
          },
        },
        old,
        {},
      ),
    /nomes de tabela/,
  );
  c.vectorStore = { provider: "mongodb", url: "" };
  assert.throws(
    () => validatedIndexConfig(c, result.config, result.secrets),
    /conexão do banco/,
  );
});

test("MongoDB aguarda o Atlas ficar consultável, isola gerações e fecha conexões inclusive nas falhas", async (t) => {
  const { MongoClient } = await import("mongodb");
  let closed = 0,
    failed = false;
  const inserted: unknown[] = [],
    definitions: unknown[] = [],
    pipelines: unknown[] = [],
    deleted: unknown[] = [],
    collections: string[] = [];
  const col = {
    insertMany: async (documents: unknown[]) => {
      inserted.push(...documents);
    },
    createSearchIndex: async (definition: unknown) => {
      definitions.push(definition);
    },
    listSearchIndexes: () => ({
      toArray: async () => [
        { queryable: !failed, status: failed ? "FAILED" : "READY" },
      ],
    }),
    aggregate: (pipeline: unknown) => {
      pipelines.push(pipeline);
      return { toArray: async () => [{ chunkId: rows[1].id }] };
    },
    deleteMany: async (filter: unknown) => {
      deleted.push(filter);
    },
    drop: async () => {
      deleted.push("drop");
    },
  };
  t.mock.method(
    MongoClient.prototype,
    "connect",
    async function (this: InstanceType<typeof MongoClient>) {
      return this;
    },
  );
  t.mock.method(MongoClient.prototype, "close", async () => {
    closed++;
  });
  t.mock.method(MongoClient.prototype, "db", (() => ({
    collection: (name: string) => {
      collections.push(name);
      return col;
    },
  })) as never);
  const c = {
    ...config("mongodb"),
    connectionString: "mongodb://localhost:27017/fixture",
  };
  await writeVectorGeneration(c, scope, rows);
  assert.equal(inserted.length, 2);
  assert.deepEqual(definitions[0], {
    name: "knowledge_vector",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: 3,
          similarity: "cosine",
        },
      ],
    },
  });
  assert.deepEqual(await queryVectorGeneration(c, scope, [0, 1, 0], 1), [
    rows[1].id,
  ]);
  assert.deepEqual(pipelines[0], [
    {
      $vectorSearch: {
        index: "knowledge_vector",
        path: "embedding",
        queryVector: [0, 1, 0],
        numCandidates: 100,
        limit: 1,
      },
    },
    { $project: { _id: 0, chunkId: 1 } },
  ]);
  await deleteVectorGeneration(c, scope, [rows[0].id]);
  await deleteVectorGeneration(c, scope);
  assert.deepEqual(deleted, [{ chunkId: { $in: [rows[0].id] } }, "drop"]);
  assert.equal(closed, 4);
  assert.equal(new Set(collections).size, 1);
  assert.equal(collections[0], vectorCollection(scope));
  failed = true;
  await assert.rejects(
    writeVectorGeneration(c, { ...scope, generation: randomUUID() }, rows),
    /Atlas/,
  );
  assert.equal(closed, 5);
  assert.notEqual(collections.at(-1), collections[0]);
});

test("SingleStore normaliza os vetores para cosseno, parametriza conteúdo e fecha conexões nas falhas", async (t) => {
  const { default: mysql } = await import("mysql2/promise");
  const statements: { sql: string; params?: unknown[] }[] = [];
  let closed = 0,
    failed = false;
  const db = {
    execute: async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
      if (failed) throw new Error("secret-password");
      return [sql.startsWith("SELECT") ? [{ id: rows[0].id }] : []];
    },
    end: async () => {
      closed++;
    },
    destroy: () => {},
  };
  t.mock.method(mysql, "createConnection", (async () => db) as never);
  const c = {
    ...config("singlestore"),
    connectionString: "mysql://user:secret-password@localhost/fixture",
  };
  await writeVectorGeneration(c, scope, [
    { ...rows[0], content: "texto'); DROP TABLE users;--", vector: [3, 4, 0] },
  ]);
  assert.ok(!statements[1].sql.includes("DROP TABLE users"));
  assert.deepEqual(
    JSON.parse(statements[1].params?.[4] as string),
    [0.6, 0.8, 0],
  );
  assert.deepEqual(await queryVectorGeneration(c, scope, [3, 4, 0], 1), [
    rows[0].id,
  ]);
  assert.match(statements[2].sql, /DOT_PRODUCT/);
  assert.deepEqual(statements[2].params, ["[0.6,0.8,0]", 1]);
  await deleteVectorGeneration(c, scope, [rows[0].id]);
  await deleteVectorGeneration(c, scope);
  assert.match(statements[3].sql, /WHERE id=\?/);
  assert.match(statements[4].sql, /DROP TABLE IF EXISTS/);
  assert.equal(closed, 4);
  failed = true;
  await assert.rejects(
    queryVectorGeneration(c, scope, [1, 0, 0], 1),
    (e: Error) =>
      !e.message.includes("secret-password") &&
      /banco vetorial/.test(e.message),
  );
  assert.equal(closed, 5);
});
