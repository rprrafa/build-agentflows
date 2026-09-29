import { retainedKnowledgeChunks } from "./knowledge-cleanup";
import { matchesMetadata, validatedRetrieval } from "./knowledge-retrieval";
import { embedKnowledge } from "./knowledge-embeddings";
export { embedKnowledge, validateVectors } from "./knowledge-embeddings";
import { createHash, randomUUID } from "node:crypto";
import { FlowError } from "./flow-store";
import { getConfig, setConfig } from "./store";
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
  knowledgeDb,
  listKnowledgeChunks,
  listKnowledgeSources,
  replaceKnowledgeChunks,
  saveKnowledgeBaseRecord,
  saveKnowledgeRun,
  saveKnowledgeSourceRecord,
  withKnowledgeLock,
} from "./knowledge-store";
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
function snapshot(baseId: string): IndexSnapshot | undefined {
  const row = knowledgeDb()
    .prepare("SELECT body FROM knowledge_indexes WHERE base_id=?")
    .get(baseId) as { body: string } | undefined;
  return row ? JSON.parse(row.body) : undefined;
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
    const { source, config, files } = getKnowledgeSourcePrivate(
      baseId,
      sourceId,
    );
    source.status = "processing";
    source.error = undefined;
    saveKnowledgeSourceRecord(source);
    try {
      const result = await extractKnowledge(
        source.loader,
        config,
        files,
        AbortSignal.timeout(600000),
      );
      const chunks = await splitDocuments(
        result.documents,
        source.id,
        source.splitter,
        source.metadata,
      );
      return {
        source: replaceKnowledgeChunks(baseId, sourceId, chunks, token),
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
      saveKnowledgeSourceRecord(source);
      throw new FlowError(
        source.error,
        error instanceof FlowError ? error.status : 502,
      );
    }
  });
}
async function cleanGeneration(baseId: string, generation: string) {
  const configText = getConfig(secretKey(generation));
  if (configText) {
    const config = JSON.parse(configText) as IndexConfig["vectorStore"];
    await deleteVectorGeneration(
      config,
      { baseId, generation, dimensions: 0 },
      undefined,
      AbortSignal.timeout(30000),
    );
  }
  const recordText = getConfig(recordSecretKey(generation));
  if (recordText)
    await deleteManagedRecords(JSON.parse(recordText), baseId, generation);
  knowledgeDb()
    .prepare("DELETE FROM knowledge_vectors WHERE base_id=? AND generation=?")
    .run(baseId, generation);
  knowledgeDb()
    .prepare("DELETE FROM knowledge_cleanup WHERE id=? AND base_id=?")
    .run(generation, baseId);
  setConfig(secretKey(generation), null);
  setConfig(recordSecretKey(generation), null);
}
export async function cleanupKnowledge(baseId: string) {
  const active = snapshot(baseId)?.generation;
  const rows = knowledgeDb()
    .prepare("SELECT id FROM knowledge_cleanup WHERE base_id=?")
    .all(baseId) as { id: string }[];
  const failed: string[] = [];
  let attempted = 0;
  for (const row of rows)
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
    const base = getKnowledgeBase(baseId);
    const sources = listKnowledgeSources(baseId);
    const incoming = listKnowledgeChunks(baseId);
    const previous = snapshot(baseId);
    if ((!incoming.length && !previous) || sources.some((s) => s.status !== "processed"))
      throw new FlowError("Extraia e revise todas as fontes antes de indexar.");
    const config = indexKnowledgeConfig(baseId);
    const priorRows = previous ? knowledgeDb().prepare(
      "SELECT hash,body FROM knowledge_vectors WHERE base_id=? AND generation=?",
    ).all(baseId, previous.generation) as { hash: string; body: string }[] : [];
    const priorRecords = priorRows.map(row => ({ hash: row.hash, record: JSON.parse(row.body) as VectorRecord }));
    const retained = retainedKnowledgeChunks(config.recordManager, incoming, priorRecords.map(({ record }) => record.chunk));
    const chunks = [...incoming, ...retained];
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
    const signal = AbortSignal.timeout(600000);
    base.status = "indexing";
    base.error = undefined;
    saveKnowledgeBaseRecord(base);
    saveKnowledgeRun(run);
    const d = knowledgeDb();
    // Every staged generation is also a durable cleanup task, including abandoned jobs.
    d.prepare("INSERT INTO knowledge_cleanup VALUES(?,?,?)").run(
      generation,
      baseId,
      "{}",
    );
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
      if (config.recordManager.provider === "sqlite" && previous) {
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
        saveKnowledgeRun(run);
      }
      const dimensions = records[0]?.record.vector.length ?? previous?.dimensions ?? 0;
      if (records.some(({ record }) => record.vector.length !== dimensions))
        throw new FlowError(
          "O modelo retornou dimensões diferentes. Use outro modelo ou desative o reaproveitamento para reindexar.",
        );
      if (records.length) {
        setConfig(secretKey(generation), JSON.stringify(config.vectorStore));
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
        setConfig(
          recordSecretKey(generation),
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
      d.exec("BEGIN IMMEDIATE");
      try {
        const insert = d.prepare(
          "INSERT INTO knowledge_vectors VALUES(?,?,?,?,?)",
        );
        for (const record of records)
          insert.run(
            baseId,
            generation,
            record.record.chunk.id,
            record.hash,
            JSON.stringify(record.record),
          );
        const next: IndexSnapshot = {
          generation,
          revision: base.revision,
          config: base.config,
          dimensions,
        };
        d.prepare(
          "INSERT INTO knowledge_indexes VALUES(?,?,?) ON CONFLICT(base_id) DO UPDATE SET generation=excluded.generation,body=excluded.body",
        ).run(baseId, generation, JSON.stringify(next));
        base.status = "ready";
        base.indexedChunks = chunks.length;
        base.indexedRevision = base.revision;
        base.indexedAt = new Date().toISOString();
        base.updatedAt = base.indexedAt;
        run.status = "completed";
        run.finishedAt = base.indexedAt;
        saveKnowledgeBaseRecord(base);
        saveKnowledgeRun(run);
        d.exec("COMMIT");
      } catch (error) {
        d.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      base.status = "failed";
      base.error =
        error instanceof FlowError
          ? error.message
          : "Não foi possível concluir a indexação. Confira os serviços e tente novamente.";
      run.status = "failed";
      run.error = base.error;
      run.finishedAt = new Date().toISOString();
      saveKnowledgeBaseRecord(base);
      saveKnowledgeRun(run);
      throw new FlowError(base.error, 502);
    } finally {
      // Failures are retained durably for retry, never reported as a successful cleanup.
      await cleanupKnowledge(baseId);
    }
    return { base: getKnowledgeBase(baseId), run };
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
  const base = getKnowledgeBase(baseId);
  const current = snapshot(baseId);
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
  if (!knowledgeDb().prepare("SELECT 1 FROM knowledge_vectors WHERE base_id=? AND generation=? LIMIT 1").get(baseId, current.generation))
    return [];
  const config = indexKnowledgeConfig(baseId);
  const [vector] = await embedKnowledge(
    config.embeddings,
    [query],
    signal,
    "query",
  );
  if (vector.length !== current.dimensions)
    throw new FlowError("As dimensões do modelo mudaram. Reindexe a base.");
  const records = (
    knowledgeDb()
      .prepare(
        "SELECT body FROM knowledge_vectors WHERE base_id=? AND generation=?",
      )
      .all(baseId, current.generation) as { body: string }[]
  ).map((row) => JSON.parse(row.body) as VectorRecord);
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
  if (
    getKnowledgeBase(baseId).revision !== base.revision ||
    snapshot(baseId)?.generation !== current.generation
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
    if (knowledgeBaseUsages(baseId).length)
      throw new FlowError(
        "Esta base está vinculada a um bloco Agente ou LLM. Remova o vínculo nos fluxos antes de excluir.",
        409,
      );
    const base = getKnowledgeBase(baseId);
    base.status = base.chunks ? "dirty" : "empty";
    saveKnowledgeBaseRecord(base);
    const rows = knowledgeDb()
      .prepare("SELECT id FROM knowledge_cleanup WHERE base_id=?")
      .all(baseId) as { id: string }[];
    for (const row of rows) await cleanGeneration(baseId, row.id);
    deleteKnowledgeBaseRecords(baseId, token);
    return { ok: true };
  });
}
export async function removeKnowledgeSource(baseId: string, sourceId: string) {
  return withKnowledgeLock(baseId, async (token) => {
    getKnowledgeSourcePrivate(baseId, sourceId);
    const rows = knowledgeDb()
      .prepare(
        "SELECT generation,chunk_id FROM knowledge_vectors WHERE base_id=? AND json_extract(body,'$.chunk.sourceId')=?",
      )
      .all(baseId, sourceId) as { generation: string; chunk_id: string }[];
    for (const generation of new Set(rows.map((r) => r.generation))) {
      const text = getConfig(secretKey(generation));
      if (!text) continue;
      const config = JSON.parse(text) as IndexConfig["vectorStore"];
      await deleteVectorGeneration(
        config,
        { baseId, generation, dimensions: 0 },
        rows.filter((r) => r.generation === generation).map((r) => r.chunk_id),
      );
      const recordText = getConfig(recordSecretKey(generation));
      if (recordText)
        await deleteManagedRecords(
          JSON.parse(recordText),
          baseId,
          generation,
          sourceId,
        );
    }
    deleteKnowledgeSource(baseId, sourceId, token);
    return { ok: true };
  });
}

export function knowledgeStorageLocation(baseId: string) {
  const current = snapshot(baseId);
  if (!current || !getConfig(secretKey(current.generation))) return undefined;
  return vectorStorageLocation(current.config.vectorStore, { baseId, generation: current.generation, dimensions: current.dimensions });
}
