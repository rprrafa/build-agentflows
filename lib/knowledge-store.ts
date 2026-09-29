import { knowledgeBaseIds } from "./knowledge-settings";
import {
  saveToolCredential,
  resolveEmbeddingCredential,
} from "./tool-credential-store";
import {
  embeddingCredentialKey,
  embeddingCredentialUrl,
  embeddingCredentialProvider,
} from "./embedding-credentials";
import { postgresConnectionString } from "./knowledge-postgres";
import { indexingConfigIdentity } from "./knowledge-retrieval";
import { validatedIndexConfig } from "./knowledge-config";
import { randomUUID } from "node:crypto";
import { abrirBanco, getConfig, setConfig } from "./store";
import { FlowError, listFlows } from "./flow-store";
import { normalizeKnowledgeSource } from "./knowledge-source-input";
import {
  DEFAULT_INDEX,
  type Chunk,
  type IndexConfig,
  type IndexRun,
  type KnowledgeBase,
  type KnowledgeSource,
  type SplitterConfig,
} from "./knowledge-types";
import { type SourceFile } from "./knowledge-loaders";

export function knowledgeDb() {
  const d = abrirBanco();
  d.exec(`CREATE TABLE IF NOT EXISTS knowledge_bases(id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_sources(id TEXT PRIMARY KEY, base_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS knowledge_sources_base ON knowledge_sources(base_id);
    CREATE TABLE IF NOT EXISTS knowledge_chunks(id TEXT PRIMARY KEY, base_id TEXT NOT NULL, source_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS knowledge_chunks_base ON knowledge_chunks(base_id);
    CREATE TABLE IF NOT EXISTS knowledge_vectors(base_id TEXT NOT NULL, generation TEXT NOT NULL, chunk_id TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(base_id,generation,chunk_id));
    CREATE TABLE IF NOT EXISTS knowledge_indexes(base_id TEXT PRIMARY KEY, generation TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_runs(id TEXT PRIMARY KEY, base_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_locks(base_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_cleanup(id TEXT PRIMARY KEY, base_id TEXT NOT NULL, body TEXT NOT NULL);`);
  return d;
}
function transaction<T>(fn: () => T): T {
  const d = knowledgeDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}
function fromRow<T>(row: unknown): T | undefined {
  return row ? (JSON.parse((row as { body: string }).body) as T) : undefined;
}
const secretKey = (id: string) => `KNOWLEDGE_${id}`;
const now = () => new Date().toISOString();
export function saveKnowledgeBaseRecord(base: KnowledgeBase) {
  knowledgeDb()
    .prepare(
      "INSERT INTO knowledge_bases VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
    )
    .run(base.id, JSON.stringify(base));
}
function migrateEmbeddingCredential(base: KnowledgeBase) {
  if (base.config.embeddings.credentialId) return;
  const secrets = getKnowledgeSecrets(base.id);
  if (!secrets.embeddingKey) return;
  const d = knowledgeDb();
  d.exec("SAVEPOINT knowledge_embedding_credential");
  try {
    const embedding = base.config.embeddings;
    const saved = saveToolCredential({
      name: `${base.name.slice(0, 55)} · ${embedding.provider} · ${randomUUID().slice(0, 8)}`,
      provider: embeddingCredentialProvider(embedding.provider),
      fields: {
        [embeddingCredentialKey(embedding.provider)]: secrets.embeddingKey,
        [embeddingCredentialUrl(embedding.provider)]: embedding.url,
      },
    });
    base.config.embeddings = {
      ...embedding,
      credentialId: saved.id,
      configured: true,
    };
    delete secrets.embeddingKey;
    setConfig(secretKey(base.id), JSON.stringify(secrets));
    saveKnowledgeBaseRecord(base);
    d.exec("RELEASE knowledge_embedding_credential");
  } catch (error) {
    d.exec("ROLLBACK TO knowledge_embedding_credential");
    d.exec("RELEASE knowledge_embedding_credential");
    throw error;
  }
}
export function migrateKnowledgeCredentials() {
  for (const row of knowledgeDb()
    .prepare("SELECT body FROM knowledge_bases")
    .all() as { body: string }[])
    migrateEmbeddingCredential(JSON.parse(row.body));
}
export function getKnowledgeBase(id: string): KnowledgeBase {
  const base = fromRow<KnowledgeBase>(
    knowledgeDb()
      .prepare("SELECT body FROM knowledge_bases WHERE id=?")
      .get(id),
  );
  if (!base)
    throw new FlowError("Esta base de conhecimento não existe mais.", 404);
  migrateEmbeddingCredential(base);
  // A process restart cannot leave an apparently live indexing job forever.
  if (
    base.status === "indexing" &&
    !knowledgeDb()
      .prepare("SELECT 1 FROM knowledge_locks WHERE base_id=? AND expires>?")
      .get(id, Date.now())
  ) {
    base.status = "failed";
    base.error =
      "A indexação foi interrompida. Tente novamente para continuar.";
    saveKnowledgeBaseRecord(base);
    for (const run of listKnowledgeRuns(id))
      if (run.status === "running")
        saveKnowledgeRun({
          ...run,
          status: "failed",
          error: base.error,
          finishedAt: now(),
        });
  }
  if (
    !knowledgeDb()
      .prepare("SELECT 1 FROM knowledge_locks WHERE base_id=? AND expires>?")
      .get(id, Date.now())
  ) {
    for (const source of listKnowledgeSources(id))
      if (source.status === "processing") {
        source.status = "failed";
        source.error = "A extração foi interrompida. Tente novamente.";
        saveKnowledgeSourceRecord(source);
      }
  }
  return base;
}
export function listKnowledgeBases() {
  return (
    knowledgeDb().prepare("SELECT id FROM knowledge_bases").all() as {
      id: string;
    }[]
  )
    .map(({ id }) => getKnowledgeBase(id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function assertKnowledgeUnlocked(id: string, token?: string) {
  const lock = knowledgeDb()
    .prepare("SELECT token FROM knowledge_locks WHERE base_id=? AND expires>?")
    .get(id, Date.now()) as { token: string } | undefined;
  if (lock && lock.token !== token)
    throw new FlowError(
      "Há uma operação em andamento nesta base. Aguarde a conclusão.",
      409,
    );
}
export async function withKnowledgeLock<T>(
  id: string,
  fn: (token: string) => Promise<T>,
) {
  getKnowledgeBase(id);
  const token = randomUUID();
  transaction(() => {
    assertKnowledgeUnlocked(id);
    knowledgeDb()
      .prepare("INSERT OR REPLACE INTO knowledge_locks VALUES(?,?,?)")
      .run(id, token, Date.now() + 900000);
  });
  try {
    return await fn(token);
  } finally {
    knowledgeDb()
      .prepare("DELETE FROM knowledge_locks WHERE base_id=? AND token=?")
      .run(id, token);
  }
}
function title(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw new FlowError(`${label} precisa ter de 1 a 100 caracteres.`);
  return value.trim();
}
export function createKnowledgeBase(input: {
  name?: unknown;
  description?: unknown;
}) {
  const base: KnowledgeBase = {
    id: randomUUID(),
    name: title(input.name, "O nome"),
    description:
      typeof input.description === "string"
        ? input.description.slice(0, 2000)
        : "",
    status: "empty",
    revision: 0,
    sources: 0,
    chunks: 0,
    indexedChunks: 0,
    config: structuredClone(DEFAULT_INDEX),
    updatedAt: now(),
  };
  saveKnowledgeBaseRecord(base);
  return base;
}
export function touchKnowledgeBase(id: string) {
  const base = getKnowledgeBase(id);
  base.revision++;
  base.updatedAt = now();
  base.error = undefined;
  const sources = listKnowledgeSources(id);
  base.sources = sources.length;
  base.chunks = sources.reduce((total, s) => total + s.chunks, 0);
  base.status = base.chunks ? "dirty" : "empty";
  saveKnowledgeBaseRecord(base);
  return base;
}
export function getKnowledgeSecrets(id: string): Record<string, string> {
  const text = getConfig(secretKey(id));
  return text ? JSON.parse(text) : {};
}
export function indexKnowledgeConfig(id: string): IndexConfig {
  const base = getKnowledgeBase(id);
  const secrets = getKnowledgeSecrets(id);
  const saved = base.config.embeddings.credentialId
    ? resolveEmbeddingCredential(
        base.config.embeddings.credentialId,
        base.config.embeddings.provider,
      )
    : undefined;
  if (saved && saved.url !== base.config.embeddings.url)
    throw new FlowError(
      "O endereço da credencial foi alterado. Selecione a conexão novamente, salve e reindexe a base.",
    );
  return {
    ...base.config,
    embeddings: {
      ...base.config.embeddings,
      apiKey: saved?.apiKey || secrets.embeddingKey,
    },
    vectorStore: {
      ...base.config.vectorStore,
      apiKey: secrets.vectorKey,
      connectionString: base.config.vectorStore.postgres ? postgresConnectionString(base.config.vectorStore.postgres) : secrets.vectorConnection,
    },
    recordManager: {
      ...base.config.recordManager,
      connectionString: base.config.recordManager.postgres ? postgresConnectionString(base.config.recordManager.postgres) : secrets.recordConnection,
    },
  };
}
export function updateKnowledgeBase(
  id: string,
  input: { name?: unknown; description?: unknown; config?: IndexConfig },
) {
  return transaction(() => {
    assertKnowledgeUnlocked(id);
    const base = getKnowledgeBase(id);
    if (input.name !== undefined) base.name = title(input.name, "O nome");
    if (input.description !== undefined) {
      if (
        typeof input.description !== "string" ||
        input.description.length > 2000
      )
        throw new FlowError("Use uma descrição de até 2.000 caracteres.");
      base.description = input.description;
    }
    if (input.config !== undefined) {
      const previous = indexingConfigIdentity(base.config);
      const result = validatedIndexConfig(
        input.config,
        base.config,
        getKnowledgeSecrets(id),
      );
      setConfig(secretKey(id), JSON.stringify(result.secrets));
      base.config = result.config;
      migrateEmbeddingCredential(base);
      if (
        previous !== indexingConfigIdentity(base.config) ||
        input.config.embeddings.apiKey?.trim() ||
        input.config.vectorStore.apiKey?.trim() ||
        input.config.vectorStore.connectionString?.trim() ||
        input.config.recordManager.connectionString?.trim()
      ) {
        base.revision++;
        base.status = base.chunks ? "dirty" : "empty";
      }
    }
    base.updatedAt = now();
    saveKnowledgeBaseRecord(base);
    return base;
  });
}
export function listKnowledgeSources(baseId: string): KnowledgeSource[] {
  return (
    knowledgeDb()
      .prepare(
        "SELECT body FROM knowledge_sources WHERE base_id=? ORDER BY rowid",
      )
      .all(baseId) as { body: string }[]
  ).map((row) => JSON.parse(row.body));
}
export function getKnowledgeSource(baseId: string, id: string) {
  const source = fromRow<KnowledgeSource>(
    knowledgeDb()
      .prepare("SELECT body FROM knowledge_sources WHERE id=? AND base_id=?")
      .get(id, baseId),
  );
  if (!source) throw new FlowError("Esta fonte não existe nesta base.", 404);
  return source;
}
export function getKnowledgeSourcePrivate(baseId: string, id: string) {
  const source = getKnowledgeSource(baseId, id);
  const secrets = getKnowledgeSecrets(id);
  return {
    source,
    config: {
      ...source.config,
      ...JSON.parse(secrets.config || "{}"),
    } as Record<string, string>,
    files: JSON.parse(secrets.files || "[]") as SourceFile[],
  };
}
export function saveKnowledgeSource(
  baseId: string,
  input: {
    name: string;
    loader: string;
    config: Record<string, string>;
    splitter: SplitterConfig;
    metadata: Record<string, unknown>;
  },
  files?: SourceFile[],
  id?: string,
) {
  return transaction(() => {
    getKnowledgeBase(baseId);
    assertKnowledgeUnlocked(baseId);
    const previous = id ? getKnowledgeSource(baseId, id) : undefined;
    const { source, secrets } = normalizeKnowledgeSource(baseId, input, files, previous, previous ? getKnowledgeSecrets(previous.id) : {});
    const sourceId = source.id;
    setConfig(secretKey(sourceId), JSON.stringify(secrets));
    knowledgeDb()
      .prepare(
        "INSERT INTO knowledge_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(sourceId, baseId, JSON.stringify(source));
    touchKnowledgeBase(baseId);
    return source;
  });
}
export function saveKnowledgeSourceRecord(source: KnowledgeSource) {
  knowledgeDb()
    .prepare("UPDATE knowledge_sources SET body=? WHERE id=? AND base_id=?")
    .run(JSON.stringify(source), source.id, source.baseId);
}
export function replaceKnowledgeChunks(
  baseId: string,
  sourceId: string,
  chunks: Chunk[],
  lockToken: string,
) {
  return transaction(() => {
    assertKnowledgeUnlocked(baseId, lockToken);
    const source = getKnowledgeSource(baseId, sourceId);
    const otherCount = Number(
      (
        knowledgeDb()
          .prepare(
            "SELECT count(*) n FROM knowledge_chunks WHERE base_id=? AND source_id<>?",
          )
          .get(baseId, sourceId) as { n: number }
      ).n,
    );
    if (otherCount + chunks.length > 10000)
      throw new FlowError(
        "Esta base aceita até 10.000 fragmentos. Divida o conteúdo em mais bases.",
      );
    knowledgeDb()
      .prepare("DELETE FROM knowledge_chunks WHERE source_id=? AND base_id=?")
      .run(sourceId, baseId);
    const insert = knowledgeDb().prepare(
      "INSERT INTO knowledge_chunks VALUES(?,?,?,?)",
    );
    for (const chunk of chunks)
      insert.run(chunk.id, baseId, sourceId, JSON.stringify(chunk));
    source.status = "processed";
    source.error = undefined;
    source.chunks = chunks.length;
    source.characters = chunks.reduce((n, c) => n + c.pageContent.length, 0);
    source.updatedAt = now();
    saveKnowledgeSourceRecord(source);
    touchKnowledgeBase(baseId);
    return source;
  });
}
export function listKnowledgeChunks(
  baseId: string,
  sourceId?: string,
): Chunk[] {
  const rows = sourceId
    ? knowledgeDb()
        .prepare(
          "SELECT body FROM knowledge_chunks WHERE base_id=? AND source_id=? ORDER BY rowid",
        )
        .all(baseId, sourceId)
    : knowledgeDb()
        .prepare(
          "SELECT body FROM knowledge_chunks WHERE base_id=? ORDER BY rowid",
        )
        .all(baseId);
  return (rows as { body: string }[]).map((r) => JSON.parse(r.body));
}
export function editKnowledgeChunk(
  baseId: string,
  id: string,
  input: { pageContent: string; metadata: Record<string, unknown> } | null,
) {
  return transaction(() => {
    assertKnowledgeUnlocked(baseId);
    const chunk = fromRow<Chunk>(
      knowledgeDb()
        .prepare("SELECT body FROM knowledge_chunks WHERE base_id=? AND id=?")
        .get(baseId, id),
    );
    if (!chunk) throw new FlowError("Fragmento não encontrado.", 404);
    if (input) {
      if (
        typeof input.pageContent !== "string" ||
        !input.pageContent.trim() ||
        input.pageContent.length > 8000 ||
        !input.metadata ||
        typeof input.metadata !== "object" ||
        Array.isArray(input.metadata) ||
        JSON.stringify(input.metadata).length > 10000
      )
        throw new FlowError(
          "Use texto de até 8.000 caracteres e metadados JSON de até 10 KB.",
        );
      knowledgeDb()
        .prepare("UPDATE knowledge_chunks SET body=? WHERE id=? AND base_id=?")
        .run(
          JSON.stringify({
            ...chunk,
            pageContent: input.pageContent,
            metadata: input.metadata,
          }),
          id,
          baseId,
        );
    } else
      knowledgeDb()
        .prepare("DELETE FROM knowledge_chunks WHERE base_id=? AND id=?")
        .run(baseId, id);
    const source = getKnowledgeSource(baseId, chunk.sourceId);
    const chunks = listKnowledgeChunks(baseId, source.id);
    source.chunks = chunks.length;
    source.characters = chunks.reduce((n, c) => n + c.pageContent.length, 0);
    source.updatedAt = now();
    saveKnowledgeSourceRecord(source);
    touchKnowledgeBase(baseId);
  });
}
export function deleteKnowledgeSource(
  baseId: string,
  id: string,
  lockToken?: string,
) {
  return transaction(() => {
    assertKnowledgeUnlocked(baseId, lockToken);
    getKnowledgeSource(baseId, id);
    knowledgeDb()
      .prepare("DELETE FROM knowledge_sources WHERE id=? AND base_id=?")
      .run(id, baseId);
    knowledgeDb()
      .prepare("DELETE FROM knowledge_chunks WHERE source_id=? AND base_id=?")
      .run(id, baseId);
    knowledgeDb()
      .prepare(
        "DELETE FROM knowledge_vectors WHERE base_id=? AND json_extract(body,'$.chunk.sourceId')=?",
      )
      .run(baseId, id);
    setConfig(secretKey(id), null);
    touchKnowledgeBase(baseId);
  });
}
export function knowledgeBaseUsages(id: string) {
  return listFlows()
    .filter((f) =>
      [f.graph, f.published].some((g) =>
        g?.nodes.some(
          (n) => ["agent", "llm"].includes(n.data.kind) && knowledgeBaseIds(n.data.config).includes(id),
        ),
      ),
    )
    .map((f) => ({ id: f.id, name: f.name }));
}
export function deleteKnowledgeBaseRecords(id: string, token: string) {
  transaction(() => {
    assertKnowledgeUnlocked(id, token);
    if (knowledgeBaseUsages(id).length)
      throw new FlowError(
        "Esta base está vinculada a um bloco Agente ou LLM. Remova o vínculo nos fluxos antes de excluir.",
        409,
      );
    for (const source of listKnowledgeSources(id))
      setConfig(secretKey(source.id), null);
    for (const table of [
      "knowledge_sources",
      "knowledge_chunks",
      "knowledge_vectors",
      "knowledge_indexes",
      "knowledge_runs",
      "knowledge_cleanup",
    ])
      knowledgeDb().prepare(`DELETE FROM ${table} WHERE base_id=?`).run(id);
    knowledgeDb().prepare("DELETE FROM knowledge_bases WHERE id=?").run(id);
    setConfig(secretKey(id), null);
  });
}
export function saveKnowledgeRun(run: IndexRun) {
  knowledgeDb()
    .prepare(
      "INSERT INTO knowledge_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
    )
    .run(run.id, run.baseId, JSON.stringify(run));
}
export function listKnowledgeRuns(baseId: string): IndexRun[] {
  return (
    knowledgeDb()
      .prepare(
        "SELECT body FROM knowledge_runs WHERE base_id=? ORDER BY rowid DESC LIMIT 20",
      )
      .all(baseId) as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
