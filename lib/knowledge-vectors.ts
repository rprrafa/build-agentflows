import { currentPostgresConnection } from "./knowledge-postgres";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { knowledgeFetch, KnowledgeServiceError } from "./knowledge-http";
import { FlowError } from "./flow-store";
import { sqlIdentifier } from "./knowledge-config";
import { withKnowledgePostgres } from "./knowledge-database";
import type { IndexConfig, RetrievalConfig } from "./knowledge-types";
import { tenantId } from "./tenant-context";
import { privateDataDirectory } from "./tenant-files";
export type VectorScope = {
  baseId: string;
  generation: string;
  dimensions: number;
};
export type StoredVector = {
  id: string;
  vector: number[];
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
};
type Config = IndexConfig["vectorStore"];
const digest = (s: VectorScope) =>
  createHash("sha256")
    .update(`${tenantId()}:${s.baseId}:${s.generation}`)
    .digest("hex")
    .slice(0, 40);
export const vectorCollection = (s: VectorScope) => `kb_${digest(s)}`;
export const vectorPointId = (id: string) =>
  `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
// Qdrant names stay compatible with indexes created before the provider expansion.
const qdrantCollection = (s: VectorScope) =>
  vectorCollection(s);
const namespace = (c: Config, s: VectorScope) =>
  `${c.options?.namespace || "agentflows"}_${digest(s)}`;
const weaviateClass = (s: VectorScope) => `Kb${digest(s)}`;
const faissDirectory = (s: VectorScope) =>
  // Índices são criados em execução no volume persistente, fora do bundle.
  privateDataDirectory("knowledge-faiss", digest(s));
function normalize(vector: number[]) {
  const n = Math.sqrt(vector.reduce((a, v) => a + v * v, 0));
  return vector.map((v) => v / n);
}
function headers(c: Config): Record<string, string> {
  if (!c.apiKey) return {};
  if (c.provider === "pinecone") return { "Api-Key": c.apiKey };
  if (c.provider === "qdrant") return { "api-key": c.apiKey };
  if (c.provider === "chroma") return { "x-chroma-token": c.apiKey };
  if (c.provider === "supabase")
    return { apikey: c.apiKey, Authorization: `Bearer ${c.apiKey}` };
  if (["elasticsearch", "opensearch"].includes(c.provider))
    return {
      Authorization: c.options?.username
        ? `Basic ${Buffer.from(`${c.options.username}:${c.apiKey}`).toString("base64")}`
        : `ApiKey ${c.apiKey}`,
    };
  return { Authorization: `Bearer ${c.apiKey}` };
}
async function request<T>(
  c: Config,
  path: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const bytes = await knowledgeFetch(`${c.url}${path}`, {
    method,
    body,
    headers: headers(c),
    infrastructure: true,
    signal,
  });
  if (!bytes.length) return undefined as T;
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new FlowError("O banco vetorial não retornou um JSON válido.", 502);
  }
}
async function missingOk(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof KnowledgeServiceError) || e.upstreamStatus !== 404)
      throw e;
  }
}
const chromaPath = (c: Config) =>
  `/api/v2/tenants/${encodeURIComponent(c.options?.tenant || "default_tenant")}/databases/${encodeURIComponent(c.options?.database || "default_database")}/collections`;
async function chromaId(c: Config, s: VectorScope, signal?: AbortSignal) {
  const r = await request<{ id: string }>(
    c,
    `${chromaPath(c)}/${vectorCollection(s)}`,
    "GET",
    undefined,
    signal,
  );
  if (!r.id) throw new FlowError("O Chroma não retornou a coleção.", 502);
  return r.id;
}
const pgTable = (c: Config, s: VectorScope) =>
  `"${sqlIdentifier(c.options?.schema || "public")}"."${sqlIdentifier((c.options?.tableName || "kb") + "_" + digest(s))}"`;
export function vectorStorageLocation(c: Config, s: VectorScope) {
  if (c.provider === "faiss") return { provider: c.provider, location: faissDirectory(s) };
  if (c.provider === "postgres") return { provider: c.provider, location: pgTable(c, s) };
  return undefined;
}
async function withMongo<T>(
  c: Config,
  fn: (collection: import("mongodb").Collection) => Promise<T>,
  s: VectorScope,
  signal?: AbortSignal,
) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(c.connectionString!, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 120000,
  });
  const abort = () => {
    void client.close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.connect();
    return await fn(
      client
        .db(c.options?.database || undefined)
        .collection(vectorCollection(s)),
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    await client.close();
  }
}
async function withSingleStore<T>(
  c: Config,
  fn: (db: import("mysql2/promise").Connection) => Promise<T>,
  signal?: AbortSignal,
) {
  const { default: mysql } = await import("mysql2/promise");
  const db = await mysql.createConnection(c.connectionString!);
  const abort = () => db.destroy();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    return await fn(db);
  } finally {
    signal?.removeEventListener("abort", abort);
    await db.end().catch(() => {});
  }
}
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError(
      "O banco vetorial não concluiu a operação. Confira conexão, permissões e configuração do índice.",
      502,
    );
  }
}
export async function writeVectorGeneration(
  c: Config,
  s: VectorScope,
  rows: StoredVector[],
  signal?: AbortSignal,
) {
  return guarded(async () => {
    signal?.throwIfAborted();
    if (c.provider === "local") return;
    if (c.provider === "faiss") {
      const {
        default: { IndexFlatIP },
      } = await import("faiss-node");
      const index = new IndexFlatIP(s.dimensions);
      for (const row of rows) index.add(normalize(row.vector));
      const folder = faissDirectory(s);
      await mkdir(folder, { recursive: true });
      index.write(join(folder, "index.faiss"));
      await writeFile(
        join(folder, "ids.json"),
        JSON.stringify(rows.map((r) => r.id)),
      );
      return;
    }
    if (c.provider === "postgres") {
      return withKnowledgePostgres(
        currentPostgresConnection(c),
        async (db) => {
          await db.query(
            `CREATE TABLE ${pgTable(c, s)} (id text PRIMARY KEY,source_id text NOT NULL,${'"' + sqlIdentifier(c.options?.contentColumnName || "content") + '"'} text,metadata jsonb,embedding vector(${s.dimensions}))`,
          );
          await db.query("BEGIN");
          try {
            const batchSize = Number(c.options?.batchSize || 100);
            if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new FlowError("Use lotes entre 1 e 1.000 registros.");
            for (let offset = 0; offset < rows.length; offset += batchSize) {
              signal?.throwIfAborted();
              const batch = rows.slice(offset, offset + batchSize);
              await db.query(
                `INSERT INTO ${pgTable(c, s)} VALUES ${batch.map((_, i) => `(${Array.from({ length: 5 }, (_, j) => `$${i * 5 + j + 1}`).join(",")})`).join(",")}`,
                batch.flatMap(r => [r.id, r.sourceId, r.content.replaceAll("\0", ""), JSON.stringify(r.metadata), JSON.stringify(r.vector)]),
              );
            }
            await db.query("COMMIT");
          } catch (e) {
            await db.query("ROLLBACK").catch(() => {});
            throw e;
          }
        },
        signal,
        c.postgres,
      );
    }
    if (c.provider === "singlestore") {
      return withSingleStore(
        c,
        async (db) => {
          await db.execute(
            `CREATE TABLE \`${vectorCollection(s)}\` (id VARCHAR(64) PRIMARY KEY,source_id VARCHAR(80),content LONGTEXT,metadata JSON,embedding BLOB)`,
          );
          for (const r of rows) {
            signal?.throwIfAborted();
            await db.execute(
              `INSERT INTO \`${vectorCollection(s)}\` VALUES(?,?,?,?,JSON_ARRAY_PACK(?))`,
              [
                r.id,
                r.sourceId,
                r.content,
                JSON.stringify(r.metadata),
                JSON.stringify(normalize(r.vector)),
              ],
            );
          }
        },
        signal,
      );
    }
    if (c.provider === "mongodb") {
      return withMongo(
        c,
        async (col) => {
          for (let i = 0; i < rows.length; i += 100)
            await col.insertMany(
              rows
                .slice(i, i + 100)
                .map((r) => ({
                  chunkId: r.id,
                  sourceId: r.sourceId,
                  content: r.content,
                  metadata: r.metadata,
                  embedding: r.vector,
                })),
              { ordered: true },
            );
          await col.createSearchIndex({
            name: "knowledge_vector",
            type: "vectorSearch",
            definition: {
              fields: [
                {
                  type: "vector",
                  path: "embedding",
                  numDimensions: s.dimensions,
                  similarity: "cosine",
                },
              ],
            },
          });
          const deadline = Date.now() + 180000;
          while (Date.now() < deadline) {
            signal?.throwIfAborted();
            const indexes = (await col
              .listSearchIndexes("knowledge_vector")
              .toArray()) as { queryable?: boolean; status?: string }[];
            if (indexes[0]?.queryable) return;
            if (indexes[0]?.status === "FAILED")
              throw new FlowError(
                "O Atlas não conseguiu criar o índice vetorial.",
                502,
              );
            await delay(1000, undefined, { signal });
          }
          throw new FlowError(
            "O Atlas ainda está preparando o índice. Tente indexar novamente em alguns minutos.",
            502,
          );
        },
        s,
        signal,
      );
    }
    let chroma = "";
    if (c.provider === "chroma") {
      const result = await request<{ id: string }>(
        c,
        chromaPath(c),
        "POST",
        {
          name: vectorCollection(s),
          configuration: { hnsw: { space: "cosine" } },
          get_or_create: false,
        },
        signal,
      );
      chroma = result.id;
      if (!chroma) throw new FlowError("O Chroma não criou a coleção.", 502);
    }
    if (c.provider === "qdrant")
      await request(
        c,
        `/collections/${qdrantCollection(s)}`,
        "PUT",
        { vectors: { size: s.dimensions, distance: "Cosine" } },
        signal,
      );
    if (c.provider === "pinecone") {
      const stats = await request<{ dimension: number }>(
        c,
        "/describe_index_stats",
        "POST",
        {},
        signal,
      );
      if (stats.dimension !== s.dimensions)
        throw new FlowError(
          "O índice Pinecone tem tamanho incompatível com o modelo escolhido. Crie ou selecione um índice compatível.",
        );
    }
    if (c.provider === "elasticsearch" || c.provider === "opensearch")
      await request(
        c,
        `/${vectorCollection(s)}`,
        "PUT",
        {
          ...(c.provider === "opensearch"
            ? { settings: { "index.knn": true } }
            : {}),
          mappings: {
            properties: {
              embedding:
                c.provider === "elasticsearch"
                  ? {
                      type: "dense_vector",
                      dims: s.dimensions,
                      index: true,
                      similarity: "cosine",
                    }
                  : {
                      type: "knn_vector",
                      dimension: s.dimensions,
                      method: {
                        name: "hnsw",
                        engine: "faiss",
                        space_type: "cosinesimil",
                      },
                    },
              chunkId: { type: "keyword" },
              sourceId: { type: "keyword" },
              content: { type: "text" },
              metadata: { type: "object", enabled: false },
            },
          },
        },
        signal,
      );
    if (c.provider === "weaviate")
      await request(
        c,
        "/v1/schema",
        "POST",
        {
          class: weaviateClass(s),
          vectorizer: "none",
          vectorIndexConfig: { distance: "cosine" },
          properties: [
            { name: "chunkId", dataType: ["text"], tokenization: "field" },
            { name: "sourceId", dataType: ["text"], tokenization: "field" },
            { name: "content", dataType: ["text"] },
            { name: "metadataJson", dataType: ["text"] },
          ],
        },
        signal,
      );
    for (let i = 0; i < rows.length; i += 64) {
      signal?.throwIfAborted();
      const batch = rows.slice(i, i + 64);
      if (c.provider === "chroma")
        await request(
          c,
          `${chromaPath(c)}/${encodeURIComponent(chroma)}/upsert`,
          "POST",
          {
            ids: batch.map((r) => r.id),
            embeddings: batch.map((r) => r.vector),
            documents: batch.map((r) => r.content),
            metadatas: batch.map((r) => ({
              sourceId: r.sourceId,
              baseId: s.baseId,
            })),
          },
          signal,
        );
      else if (c.provider === "qdrant")
        await request(
          c,
          `/collections/${qdrantCollection(s)}/points?wait=true`,
          "PUT",
          {
            points: batch.map((r) => ({
              id: vectorPointId(r.id),
              vector: r.vector,
              payload: {
                chunkId: r.id,
                sourceId: r.sourceId,
                baseId: s.baseId,
              },
            })),
          },
          signal,
        );
      else if (c.provider === "pinecone")
        await request(
          c,
          "/vectors/upsert",
          "POST",
          {
            namespace: namespace(c, s),
            vectors: batch.map((r) => ({
              id: r.id,
              values: r.vector,
              metadata: { sourceId: r.sourceId, baseId: s.baseId },
            })),
          },
          signal,
        );
      else if (c.provider === "supabase")
        await request(
          c,
          `/rest/v1/${encodeURIComponent(c.options?.tableName || "agentflows_documents")}`,
          "POST",
          batch.map((r) => ({
            id: `${s.generation}_${r.id}`,
            content: r.content,
            embedding: r.vector,
            metadata: {
              ...r.metadata,
              baseId: s.baseId,
              generation: s.generation,
              chunkId: r.id,
              sourceId: r.sourceId,
            },
          })),
          signal,
        );
      else if (c.provider === "weaviate") {
        const result = await request<{ result?: { errors?: unknown } }[]>(
          c,
          "/v1/batch/objects",
          "POST",
          {
            objects: batch.map((r) => ({
              class: weaviateClass(s),
              id: vectorPointId(r.id),
              vector: r.vector,
              properties: {
                chunkId: r.id,
                sourceId: r.sourceId,
                content: r.content,
                metadataJson: JSON.stringify(r.metadata),
              },
            })),
          },
          signal,
        );
        if (!Array.isArray(result) || result.some((r) => r.result?.errors))
          throw new FlowError(
            "O Weaviate rejeitou um ou mais documentos.",
            502,
          );
      } else if (c.provider === "elasticsearch" || c.provider === "opensearch")
        for (const r of batch)
          await request(
            c,
            `/${vectorCollection(s)}/_doc/${r.id}`,
            "PUT",
            {
              chunkId: r.id,
              sourceId: r.sourceId,
              content: r.content,
              metadata: r.metadata,
              embedding: r.vector,
            },
            signal,
          );
    }
    if (c.provider === "elasticsearch" || c.provider === "opensearch")
      await request(c, `/${vectorCollection(s)}/_refresh`, "POST", {}, signal);
    if (c.provider === "pinecone") {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const stats = await request<{
          namespaces?: Record<string, { vectorCount: number }>;
        }>(c, "/describe_index_stats", "POST", {}, signal);
        if (
          (stats.namespaces?.[namespace(c, s)]?.vectorCount || 0) >= rows.length
        )
          return;
        await delay(1000, undefined, { signal });
      }
      throw new FlowError(
        "O Pinecone ainda está disponibilizando os vetores. Tente indexar novamente.",
        502,
      );
    }
  });
}
export async function queryVectorGeneration(
  c: Config,
  s: VectorScope,
  vector: number[],
  topK: number,
  signal?: AbortSignal,
  queryOptions: { allowedIds?: string[]; metadataFilter?: Record<string, unknown>; distanceStrategy?: RetrievalConfig["distanceStrategy"] } = {},
): Promise<string[]> {
  return guarded(async () => {
    signal?.throwIfAborted();
    if (c.provider === "faiss") {
      const {
        default: { IndexFlatIP },
      } = await import("faiss-node");
      const dir = faissDirectory(s);
      const ids = JSON.parse(
        await readFile(join(dir, "ids.json"), "utf8"),
      ) as string[];
      if (!ids.length) return [];
      const index = IndexFlatIP.read(join(dir, "index.faiss"));
      const allowed = queryOptions.allowedIds ? new Set(queryOptions.allowedIds) : undefined;
      if (allowed && !allowed.size) return [];
      return index
        .search(normalize(vector), allowed ? ids.length : Math.min(topK, ids.length))
        .labels.map((i) => ids[i])
        .filter(id => !!id && (!allowed || allowed.has(id)))
        .slice(0, topK);
    }
    if (c.provider === "postgres")
      return withKnowledgePostgres(
        currentPostgresConnection(c),
        async (db) =>
          (
            await db.query(
              `SELECT id FROM ${pgTable(c, s)} WHERE metadata @> $3::jsonb ORDER BY embedding ${queryOptions.distanceStrategy === "euclidean" ? "<->" : queryOptions.distanceStrategy === "innerProduct" ? "<#>" : "<=>"} $1::vector LIMIT $2`,
              [JSON.stringify(vector), topK, JSON.stringify(queryOptions.metadataFilter || {})],
            )
          ).rows.map((r) => String(r.id)),
        signal,
        c.postgres,
      );
    if (c.provider === "singlestore")
      return withSingleStore(
        c,
        async (db) => {
          const [rows] = await db.execute<import("mysql2").RowDataPacket[]>(
            `SELECT id FROM \`${vectorCollection(s)}\` ORDER BY DOT_PRODUCT(embedding,JSON_ARRAY_PACK(?)) DESC LIMIT ?`,
            [JSON.stringify(normalize(vector)), topK],
          );
          return rows.map((r) => String(r.id));
        },
        signal,
      );
    if (c.provider === "mongodb")
      return withMongo(
        c,
        async (col) =>
          (
            await col
              .aggregate(
                [
                  {
                    $vectorSearch: {
                      index: "knowledge_vector",
                      path: "embedding",
                      queryVector: vector,
                      numCandidates: Math.max(100, topK * 20),
                      limit: topK,
                    },
                  },
                  { $project: { _id: 0, chunkId: 1 } },
                ],
                { maxTimeMS: 120000 },
              )
              .toArray()
          ).map((r) => String(r.chunkId)),
        s,
        signal,
      );
    if (c.provider === "chroma") {
      const id = await chromaId(c, s, signal);
      const result = await request<{ ids: string[][] }>(
        c,
        `${chromaPath(c)}/${id}/query`,
        "POST",
        { query_embeddings: [vector], n_results: topK, include: ["distances"] },
        signal,
      );
      if (!Array.isArray(result.ids?.[0]))
        throw new FlowError("Resposta inválida do Chroma.", 502);
      return result.ids[0];
    }
    if (c.provider === "qdrant") {
      const result = await request<{ result: { points: { id: string }[] } }>(
        c,
        `/collections/${qdrantCollection(s)}/points/query`,
        "POST",
        {
          query: vector,
          limit: topK,
          score_threshold: -1,
          with_payload: false,
          with_vector: false,
        },
        signal,
      );
      if (!Array.isArray(result.result?.points))
        throw new FlowError("Resposta inválida do Qdrant.", 502);
      return result.result.points.map((p) => p.id.replaceAll("-", ""));
    }
    if (c.provider === "pinecone") {
      const result = await request<{ matches: { id: string }[] }>(
        c,
        "/query",
        "POST",
        {
          namespace: namespace(c, s),
          vector,
          topK,
          includeValues: false,
          includeMetadata: false,
        },
        signal,
      );
      if (!Array.isArray(result.matches))
        throw new FlowError("Resposta inválida do Pinecone.", 502);
      return result.matches.map((r) => r.id);
    }
    if (c.provider === "elasticsearch" || c.provider === "opensearch") {
      const query =
        c.provider === "elasticsearch"
          ? {
              knn: {
                field: "embedding",
                query_vector: vector,
                k: topK,
                num_candidates: Math.max(100, topK * 20),
              },
            }
          : { query: { knn: { embedding: { vector, k: topK } } } };
      const result = await request<{ hits: { hits: { _id: string }[] } }>(
        c,
        `/${vectorCollection(s)}/_search`,
        "POST",
        { ...query, size: topK, _source: false },
        signal,
      );
      if (!Array.isArray(result.hits?.hits))
        throw new FlowError("Resposta inválida do índice de busca.", 502);
      return result.hits.hits.map((r) => r._id);
    }
    if (c.provider === "weaviate") {
      const name = weaviateClass(s);
      const result = await request<{
        errors?: unknown;
        data?: { Get?: Record<string, { chunkId: string }[]> };
      }>(
        c,
        "/v1/graphql",
        "POST",
        {
          query: `{Get{${name}(nearVector:{vector:${JSON.stringify(vector)}},limit:${topK}){chunkId}}}`,
        },
        signal,
      );
      if (result.errors || !Array.isArray(result.data?.Get?.[name]))
        throw new FlowError("O Weaviate não concluiu a busca.", 502);
      return result.data!.Get![name].map((r) => r.chunkId);
    }
    if (c.provider === "supabase") {
      const rows = await request<{ metadata: { chunkId: string } }[]>(
        c,
        `/rest/v1/rpc/${encodeURIComponent(c.options?.queryName || "match_agentflows_documents")}`,
        "POST",
        {
          query_embedding: vector,
          match_count: topK,
          filter: { baseId: s.baseId, generation: s.generation },
        },
        signal,
      );
      if (!Array.isArray(rows))
        throw new FlowError("Resposta inválida do Supabase.", 502);
      return rows.map((r) => r.metadata.chunkId);
    }
    throw new FlowError("Selecione um banco vetorial compatível.");
  });
}
export async function deleteVectorGeneration(
  c: Config,
  s: VectorScope,
  ids?: string[],
  signal?: AbortSignal,
) {
  return guarded(async () => {
    signal?.throwIfAborted();
    if (ids && !ids.length) return;
    if (c.provider === "local") return;
    if (c.provider === "faiss") {
      // Individual deletion rewrites the native index, preserving label-to-ID alignment.
      const dir = faissDirectory(s);
      if (!ids) {
        await rm(dir, { recursive: true, force: true });
        return;
      }
      const {
        default: { IndexFlatIP },
      } = await import("faiss-node");
      const known = JSON.parse(
        await readFile(join(dir, "ids.json"), "utf8"),
      ) as string[];
      const index = IndexFlatIP.read(join(dir, "index.faiss"));
      index.removeIds(known.flatMap((id, i) => (ids.includes(id) ? [i] : [])));
      index.write(join(dir, "index.faiss"));
      await writeFile(
        join(dir, "ids.json"),
        JSON.stringify(known.filter((id) => !ids.includes(id))),
      );
      return;
    }
    if (c.provider === "postgres")
      return withKnowledgePostgres(
        currentPostgresConnection(c),
        async (db) => {
          if (!ids) await db.query(`DROP TABLE IF EXISTS ${pgTable(c, s)}`);
          else
            await db.query(
              `DELETE FROM ${pgTable(c, s)} WHERE id=ANY($1::text[])`,
              [ids],
            );
        },
        signal,
        c.postgres,
      );
    if (c.provider === "singlestore")
      return withSingleStore(
        c,
        async (db) => {
          if (!ids)
            await db.execute(`DROP TABLE IF EXISTS \`${vectorCollection(s)}\``);
          else
            for (const id of ids)
              await db.execute(
                `DELETE FROM \`${vectorCollection(s)}\` WHERE id=?`,
                [id],
              );
        },
        signal,
      );
    if (c.provider === "mongodb")
      return withMongo(
        c,
        async (col) => {
          if (ids) await col.deleteMany({ chunkId: { $in: ids } });
          else
            try {
              await col.drop();
            } catch (e) {
              if ((e as { code?: number }).code !== 26) throw e;
            }
        },
        s,
        signal,
      );
    if (c.provider === "chroma")
      return missingOk(async () => {
        if (ids) {
          const id = await chromaId(c, s, signal);
          await request(
            c,
            `${chromaPath(c)}/${id}/delete`,
            "POST",
            { ids },
            signal,
          );
        } else
          await request(
            c,
            `${chromaPath(c)}/${vectorCollection(s)}`,
            "DELETE",
            undefined,
            signal,
          );
      });
    if (c.provider === "qdrant")
      return missingOk(() =>
        request(
          c,
          `/collections/${qdrantCollection(s)}${ids ? "/points/delete?wait=true" : ""}`,
          ids ? "POST" : "DELETE",
          ids ? { points: ids.map(vectorPointId) } : undefined,
          signal,
        ),
      );
    if (c.provider === "pinecone")
      return request(
        c,
        "/vectors/delete",
        "POST",
        {
          namespace: namespace(c, s),
          ...(ids ? { ids } : { deleteAll: true }),
        },
        signal,
      ).then(() => {});
    if (c.provider === "supabase") {
      const params = new URLSearchParams({
        "metadata->>baseId": `eq.${s.baseId}`,
        "metadata->>generation": `eq.${s.generation}`,
      });
      if (ids)
        params.set(
          "id",
          `in.(${ids.map((id) => `${s.generation}_${id}`).join(",")})`,
        );
      await request(
        c,
        `/rest/v1/${encodeURIComponent(c.options?.tableName || "agentflows_documents")}?${params}`,
        "DELETE",
        undefined,
        signal,
      );
      return;
    }
    if (c.provider === "weaviate") {
      if (ids) {
        for (const id of ids)
          await missingOk(() =>
            request(
              c,
              `/v1/objects/${weaviateClass(s)}/${vectorPointId(id)}`,
              "DELETE",
              undefined,
              signal,
            ),
          );
      } else
        await missingOk(() =>
          request(
            c,
            `/v1/schema/${weaviateClass(s)}`,
            "DELETE",
            undefined,
            signal,
          ),
        );
      return;
    }
    if (c.provider === "elasticsearch" || c.provider === "opensearch") {
      if (ids) {
        for (const id of ids)
          await missingOk(() =>
            request(
              c,
              `/${vectorCollection(s)}/_doc/${id}?refresh=true`,
              "DELETE",
              undefined,
              signal,
            ),
          );
      } else
        await missingOk(() =>
          request(c, `/${vectorCollection(s)}`, "DELETE", undefined, signal),
        );
      return;
    }
  });
}
