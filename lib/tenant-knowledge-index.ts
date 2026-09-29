import { retainedKnowledgeChunks } from "./knowledge-cleanup";
import { matchesMetadata, validatedRetrieval } from "./knowledge-retrieval";
import { embedKnowledge } from "./knowledge-embeddings";
export { embedKnowledge, validateVectors } from "./knowledge-embeddings";
import { createHash, randomUUID } from "node:crypto";
import { FlowError } from "./flow-store";
import { currentTenant } from "./tenant-context";
import { jobSignal } from "./saas-job-context";
import type { QueryResultRow } from "pg";
import { getKnowledgePrivate, putKnowledgePrivate, mutateKnowledge } from "./tenant-knowledge";
import { extractKnowledge, splitDocuments } from "./knowledge-loaders";
import {
  writeVectorGeneration,
  queryVectorGeneration,
  deleteVectorGeneration,
  vectorStorageLocation,
} from "./knowledge-vectors";
import {
  readManagedRecords,
  writeManagedRecords,
  deleteManagedRecords,
} from "./knowledge-records";
import {
  deleteKnowledgeBaseRecords,
  deleteKnowledgeSource,
  getKnowledgeBase,
  getKnowledgeSourcePrivate,
  indexKnowledgeConfig,
  knowledgeBaseUsages,
  listKnowledgeChunks,
  listKnowledgeSources,
  replaceKnowledgeChunks,
  saveKnowledgeBaseRecord,
  saveKnowledgeRun,
  saveKnowledgeSourceRecord,
  withKnowledgeLock,
} from "./tenant-knowledge";
import type {
  Chunk,
  IndexConfig,
  IndexRun,
  KnowledgeHit,
} from "./knowledge-types";

type VectorRecord = { chunk: Chunk; vector: number[]; sourceName: string };
type IndexSnapshot = {
  revision: number;
  config: IndexConfig;
  generation: string;
  dimensions: number;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const secretKey = (generation: string) => `KNOWLEDGE_VECTOR_${generation}`;
const recordSecretKey = (generation: string) =>
  `KNOWLEDGE_RECORD_${generation}`;
async function rows<T extends QueryResultRow = QueryResultRow>(query: string, values: unknown[] = []): Promise<T[]> {
  const { db, user } = currentTenant();
  return (await db.query<T>(query, [user.id, ...values])).rows;
}
async function snapshot(baseId: string): Promise<IndexSnapshot | undefined> {
  return (await rows<{ body: IndexSnapshot }>("SELECT body FROM knowledge_indexes WHERE user_id=$1 AND base_id=$2", [baseId]))[0]?.body;
}
async function secret(baseId: string, key: string) { return (await getKnowledgePrivate(baseId, key)).value; }
async function saveSecret(baseId: string, key: string, value: string) {
  await mutateKnowledge(baseId, (sql, owner) => putKnowledgePrivate(sql, owner, baseId, key, { value }));
}
function vectorHash(config: IndexConfig, chunk: Chunk) {
  return hash([
    config.embeddings.provider,
    config.embeddings.url,
    config.embeddings.model,
    ...(config.embeddings.dimensions ? [config.embeddings.dimensions] : []),
    !!config.embeddings.stripNewLines,
    chunk.pageContent,
  ]);
}
export async function processKnowledgeSource(baseId: string, sourceId: string) {
  return withKnowledgeLock(baseId, async (token) => {
    const { source, config, files } = await getKnowledgeSourcePrivate(
      baseId,
      sourceId,
    );
    source.status = "processing";
    source.error = undefined;
    await saveKnowledgeSourceRecord(source);
    try {
      const result = await extractKnowledge(
        source.loader,
        config,
        files,
        jobSignal(600000),
      );
      const chunks = await splitDocuments(
        result.documents,
        source.id,
        source.splitter,
        source.metadata,
      );
      return {
        source: await replaceKnowledgeChunks(baseId, sourceId, chunks, token),
        warnings: result.warnings,
        documents: result.documents.length,
        chunks: chunks.length,
      };
    } catch (error) {
      source.status = "failed";
      source.error =
        error instanceof FlowError
          ? error.message
          : "A extração falhou. Confira a fonte e tente novamente.";
      await saveKnowledgeSourceRecord(source);
      throw new FlowError(
        source.error,
        error instanceof FlowError ? error.status : 502,
      );
    }
  });
}
async function cleanGeneration(baseId: string, generation: string) {
  const configText = await secret(baseId, secretKey(generation));
  if (configText) {
    const config = JSON.parse(configText) as IndexConfig["vectorStore"];
    await deleteVectorGeneration(
      config,
      { baseId, generation, dimensions: 0 },
      undefined,
      AbortSignal.timeout(30000),
    );
  }
  const recordText = await secret(baseId, recordSecretKey(generation));
  if (recordText)
    await deleteManagedRecords(JSON.parse(recordText), baseId, generation);
  await mutateKnowledge(baseId, async (sql, owner) => {
    await sql.query("DELETE FROM knowledge_vectors WHERE user_id=$1 AND base_id=$2 AND generation=$3", [owner, baseId, generation]);
    await sql.query("DELETE FROM knowledge_cleanup WHERE user_id=$1 AND base_id=$2 AND id=$3", [owner, baseId, generation]);
    await sql.query("DELETE FROM knowledge_private WHERE user_id=$1 AND base_id=$2 AND resource_id=ANY($3::text[])", [owner, baseId, [secretKey(generation), recordSecretKey(generation)]]);
  });
}
export async function cleanupKnowledge(baseId: string) {
  return withKnowledgeLock(baseId, () => cleanupLocked(baseId));
}
async function cleanupLocked(baseId: string) {
  const active = (await snapshot(baseId))?.generation;
  const tasks = await rows<{ id: string }>("SELECT id FROM knowledge_cleanup WHERE user_id=$1 AND base_id=$2", [baseId]);
  const failed: string[] = [];
  let attempted = 0;
  for (const row of tasks)
    if (row.id !== active) {
      if (attempted++ >= 5) {
        failed.push(row.id);
        continue;
      }
      try {
        await cleanGeneration(baseId, row.id);
      } catch {
        failed.push(row.id);
      }
    }
  return { pending: failed.length };
}
export async function indexKnowledge(baseId: string) {
  return withKnowledgeLock(baseId, async () => {
    const base = await getKnowledgeBase(baseId);
    const sources = await listKnowledgeSources(baseId);
    const incoming = await listKnowledgeChunks(baseId);
    const previous = await snapshot(baseId);
    if ((!incoming.length && !previous) || sources.some((s) => s.status !== "processed"))
      throw new FlowError("Extraia e revise todas as fontes antes de indexar.");
    const config = await indexKnowledgeConfig(baseId);
    const priorRows = previous ? await rows<{ hash: string; body: VectorRecord }>("SELECT hash,body FROM knowledge_vectors WHERE user_id=$1 AND base_id=$2 AND generation=$3", [baseId, previous.generation]) : [];
    const priorRecords = priorRows.map(row => ({ hash: row.hash, record: row.body }));
    const retained = retainedKnowledgeChunks(config.recordManager, incoming, priorRecords.map(({ record }) => record.chunk));
    const chunks = [...incoming, ...retained];
    if (chunks.length > 10000) throw new FlowError("A retenção ultrapassou 10.000 fragmentos. Use limpeza completa ou divida a base.", 413);
    const sourceNames = new Map(priorRecords.map(({ record }) => [record.chunk.sourceId, record.sourceName]));
    for (const source of sources) sourceNames.set(source.id, source.name);
    const run: IndexRun = {
      id: randomUUID(),
      baseId,
      status: "running",
      startedAt: new Date().toISOString(),
      total: chunks.length,
      embedded: 0,
      reused: 0,
    };
    const generation = run.id;
    const signal = jobSignal(600000);
    base.status = "indexing";
    base.error = undefined;
    await saveKnowledgeBaseRecord(base);
    await saveKnowledgeRun(run);
    await mutateKnowledge(baseId, async (sql, owner) => {
      await sql.query("INSERT INTO knowledge_cleanup(user_id,base_id,id,body) VALUES($1,$2,$3,'{}')", [owner, baseId, generation]);
    });
    try {
      const existing =
        config.recordManager.provider === "postgres" && previous
          ? await readManagedRecords(
              config.recordManager,
              baseId,
              previous.generation,
              signal,
            )
          : new Map<string, number[]>();
      if (config.recordManager.provider === "internal" && previous) {
        for (const { hash, record } of priorRecords)
          existing.set(hash, record.vector);
      }
      const records: { hash: string; record: VectorRecord }[] = [];
      const pending = new Map<string, Chunk[]>();
      for (const chunk of chunks) {
        const key = vectorHash(config, chunk);
        const vector = existing.get(key);
        if (vector) {
          records.push({
            hash: key,
            record: {
              chunk,
              vector,
              sourceName: sourceNames.get(chunk.sourceId)!,
            },
          });
          run.reused++;
        } else {
          const group = pending.get(key) || [];
          group.push(chunk);
          pending.set(key, group);
        }
      }
      const entries = [...pending];
      for (
        let offset = 0;
        offset < entries.length;
        offset += config.embeddings.batchSize || 32
      ) {
        const batch = entries.slice(
          offset,
          offset + (config.embeddings.batchSize || 32),
        );
        const vectors = await embedKnowledge(
          config.embeddings,
          batch.map(([, group]) => group[0].pageContent),
          signal,
        );
        for (let i = 0; i < batch.length; i++) {
          const [key, group] = batch[i];
          for (const chunk of group)
            records.push({
              hash: key,
              record: {
                chunk,
                vector: vectors[i],
                sourceName: sourceNames.get(chunk.sourceId)!,
              },
            });
          run.embedded++;
          run.reused += group.length - 1;
        }
        await saveKnowledgeRun(run);
      }
      const dimensions = records[0]?.record.vector.length ?? previous?.dimensions ?? 0;
      if (records.some(({ record }) => record.vector.length !== dimensions))
        throw new FlowError(
          "O modelo retornou dimensões diferentes. Use outro modelo ou desative o reaproveitamento para reindexar.",
        );
      if (records.length) {
        await saveSecret(baseId, secretKey(generation), JSON.stringify(config.vectorStore));
        await writeVectorGeneration(
          config.vectorStore,
          { baseId, generation, dimensions },
          records.map(({ record }) => ({
            id: record.chunk.id,
            vector: record.vector,
            sourceId: record.chunk.sourceId,
            content: record.chunk.pageContent,
            metadata: record.chunk.metadata,
          })),
          signal,
        );
      }
      if (config.recordManager.provider === "postgres" && records.length) {
        await saveSecret(
          baseId, recordSecretKey(generation),
          JSON.stringify(config.recordManager),
        );
        await writeManagedRecords(
          config.recordManager,
          baseId,
          generation,
          records.map(({ hash, record }) => ({
            hash,
            chunkId: record.chunk.id,
            sourceId: record.chunk.sourceId,
            vector: record.vector,
          })),
          signal,
        );
      }
      signal.throwIfAborted();
      await mutateKnowledge(baseId, async (sql, owner, latest) => {
        if (latest.revision !== base.revision) throw new FlowError("A base mudou durante a indexação. Tente novamente.", 409);
        await sql.query(`INSERT INTO knowledge_vectors(user_id,base_id,generation,chunk_id,hash,body)
          SELECT $1,$2,$3,r.id,r.hash,r.body FROM jsonb_to_recordset($4::jsonb) AS r(id text,hash text,body jsonb)`,
          [owner, baseId, generation, JSON.stringify(records.map(({ hash, record }) => ({ id: record.chunk.id, hash, body: record })))]);
        const next: IndexSnapshot = { generation, revision: base.revision, config: base.config, dimensions };
        await sql.query(`INSERT INTO knowledge_indexes(user_id,base_id,generation,body) VALUES($1,$2,$3,$4)
          ON CONFLICT(user_id,base_id) DO UPDATE SET generation=excluded.generation,body=excluded.body`, [owner, baseId, generation, JSON.stringify(next)]);
        base.status = "ready"; base.indexedChunks = chunks.length; base.indexedRevision = base.revision;
        base.indexedAt = new Date().toISOString(); base.updatedAt = base.indexedAt;
        run.status = "completed"; run.finishedAt = base.indexedAt;
        await sql.query("UPDATE knowledge_bases SET body=$3,revision=revision+1 WHERE user_id=$1 AND id=$2", [owner, baseId, JSON.stringify(base)]);
        await sql.query("UPDATE knowledge_runs SET body=$4 WHERE user_id=$1 AND base_id=$2 AND id=$3", [owner, baseId, run.id, JSON.stringify(run)]);
      });
    } catch (error) {
      base.status = "failed";
      base.error =
        error instanceof FlowError
          ? error.message
          : "Não foi possível concluir a indexação. Confira os serviços e tente novamente.";
      run.status = "failed";
      run.error = base.error;
      run.finishedAt = new Date().toISOString();
      await saveKnowledgeBaseRecord(base);
      await saveKnowledgeRun(run);
      throw new FlowError(base.error, 502);
    } finally {
      // Failures are retained durably for retry, never reported as a successful cleanup.
      await cleanupKnowledge(baseId);
    }
    return { base: await getKnowledgeBase(baseId), run };
  });
}
export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length)
    throw new FlowError("As dimensões do modelo mudaram. Reindexe a base.");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export async function queryKnowledge(
  baseId: string,
  query: string,
  topK?: number,
  minScore?: number,
  signal?: AbortSignal,
): Promise<KnowledgeHit[]> {
  const base = await getKnowledgeBase(baseId);
  const current = await snapshot(baseId);
  const retrieval = validatedRetrieval(base.config.retrieval);
  topK ??= retrieval.topK;
  minScore ??= retrieval.minScore;
  if (base.status !== "ready" || !current || current.revision !== base.revision)
    throw new FlowError(
      `A base “${base.name}” precisa ser indexada antes de ser consultada.`,
    );
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 20000 ||
    !Number.isInteger(topK) ||
    topK < 1 ||
    topK > 20 ||
    !Number.isFinite(minScore) ||
    minScore < -1 ||
    minScore > 1
  )
    throw new FlowError(
      "Informe uma consulta de até 20.000 caracteres, 1 a 20 resultados e pontuação entre -1 e 1.",
    );
  if (!(await rows("SELECT 1 FROM knowledge_vectors WHERE user_id=$1 AND base_id=$2 AND generation=$3 LIMIT 1", [baseId, current.generation])).length)
    return [];
  const config = await indexKnowledgeConfig(baseId);
  const [vector] = await embedKnowledge(
    config.embeddings,
    [query],
    signal,
    "query",
  );
  if (vector.length !== current.dimensions)
    throw new FlowError("As dimensões do modelo mudaram. Reindexe a base.");
  const records = (await rows<{ body: VectorRecord }>("SELECT body FROM knowledge_vectors WHERE user_id=$1 AND base_id=$2 AND generation=$3", [baseId, current.generation])).map(row => row.body);
  let candidates = records.filter(record => matchesMetadata(record.chunk.metadata, retrieval.metadataFilter || {}));
  if (config.vectorStore.provider !== "local") {
    const ids = new Set(
      await queryVectorGeneration(
        config.vectorStore,
        {
          baseId,
          generation: current.generation,
          dimensions: current.dimensions,
        },
        vector,
        topK,
        signal,
        {
          allowedIds: Object.keys(retrieval.metadataFilter || {}).length ? candidates.map(r => r.chunk.id) : undefined,
          metadataFilter: retrieval.metadataFilter,
          distanceStrategy: retrieval.distanceStrategy,
        },
      ),
    );
    candidates = candidates.filter(
      (record) =>
        ids.has(record.chunk.id) ||
        (config.vectorStore.provider === "qdrant" &&
          ids.has(record.chunk.id.slice(0, 32))),
    );
  }
  const selected = candidates
    .map((record) => ({
      record,
      score: cosineSimilarity(vector, record.vector),
      rank: retrieval.distanceStrategy === "euclidean"
        ? -Math.sqrt(vector.reduce((sum, v, i) => sum + (v - record.vector[i]) ** 2, 0))
        : retrieval.distanceStrategy === "innerProduct"
          ? vector.reduce((sum, v, i) => sum + v * record.vector[i], 0)
          : cosineSimilarity(vector, record.vector),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, topK);
  // A concurrent edit/index must not turn an old result into the current truth.
  const latest = await getKnowledgeBase(baseId);
  if (
    latest.status !== "ready" || latest.revision !== base.revision ||
    (await snapshot(baseId))?.generation !== current.generation
  )
    throw new FlowError(
      "A base foi atualizada durante a consulta. Tente novamente.",
      409,
    );
  return selected.map(({ record, score }) => ({
    ...record.chunk,
    baseId,
    baseName: base.name,
    sourceName: record.sourceName,
    score,
  }));
}
export async function deleteKnowledgeBase(baseId: string) {
  return withKnowledgeLock(baseId, async (token) => {
    if ((await knowledgeBaseUsages(baseId)).length)
      throw new FlowError(
        "Esta base está vinculada a um bloco Agente ou LLM. Remova o vínculo nos fluxos antes de excluir.",
        409,
      );
    const base = await getKnowledgeBase(baseId);
    base.status = base.chunks ? "dirty" : "empty";
    await saveKnowledgeBaseRecord(base);
    const tasks = await rows<{ id: string }>("SELECT id FROM knowledge_cleanup WHERE user_id=$1 AND base_id=$2", [baseId]);
    for (const row of tasks) await cleanGeneration(baseId, row.id);
    await deleteKnowledgeBaseRecords(baseId, token);
    return { ok: true };
  });
}
export async function removeKnowledgeSource(baseId: string, sourceId: string) {
  return withKnowledgeLock(baseId, async (token) => {
    await getKnowledgeSourcePrivate(baseId, sourceId);
    const base = await getKnowledgeBase(baseId);
    base.status = base.chunks ? "dirty" : "empty"; base.revision++;
    await saveKnowledgeBaseRecord(base);
    const vectors = await rows<{ generation: string; chunk_id: string }>("SELECT generation,chunk_id FROM knowledge_vectors WHERE user_id=$1 AND base_id=$2 AND body#>>'{chunk,sourceId}'=$3", [baseId, sourceId]);
    for (const generation of new Set(vectors.map((r) => r.generation))) {
      const text = await secret(baseId, secretKey(generation));
      if (!text) continue;
      const config = JSON.parse(text) as IndexConfig["vectorStore"];
      await deleteVectorGeneration(
        config,
        { baseId, generation, dimensions: 0 },
        vectors.filter((r) => r.generation === generation).map((r) => r.chunk_id),
      );
      const recordText = await secret(baseId, recordSecretKey(generation));
      if (recordText)
        await deleteManagedRecords(
          JSON.parse(recordText),
          baseId,
          generation,
          sourceId,
        );
    }
    await deleteKnowledgeSource(baseId, sourceId, token);
    return { ok: true };
  });
}

export async function knowledgeStorageLocation(baseId: string) {
  const current = await snapshot(baseId);
  if (!current || !await secret(baseId, secretKey(current.generation))) return undefined;
  return vectorStorageLocation(current.config.vectorStore, { baseId, generation: current.generation, dimensions: current.dimensions });
}
