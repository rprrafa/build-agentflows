import type { IndexConfig, RetrievalConfig } from "./knowledge-types";

export function validatedRetrieval(value: unknown): Omit<RetrievalConfig, "metadataFilter"> & { metadataFilter: Record<string, unknown> } {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)))
    throw new Error("Confira as opções de busca.");
  const input = (value || {}) as Partial<RetrievalConfig>;
  const topK = input.topK ?? 4, minScore = input.minScore ?? 0;
  if (!Number.isInteger(topK) || topK < 1 || topK > 20 || !Number.isFinite(minScore) || minScore < -1 || minScore > 1)
    throw new Error("Use de 1 a 20 resultados e similaridade mínima entre -1 e 1.");
  const distanceStrategy = input.distanceStrategy ?? "cosine";
  if (!["cosine", "euclidean", "innerProduct"].includes(distanceStrategy))
    throw new Error("Escolha uma estratégia de distância válida.");
  let metadataFilter = input.metadataFilter ?? {};
  if (typeof metadataFilter === "string") {
    try { metadataFilter = JSON.parse(metadataFilter || "{}"); } catch { throw new Error("O filtro de metadados precisa ser um objeto JSON válido."); }
  }
  // Equality/containment of scalar properties, including nested objects; no query operators.
  function check(object: unknown, depth: number): boolean {
    return !!object && typeof object === "object" && !Array.isArray(object) && depth <= 5 &&
      Object.entries(object).every(([key, v]) => key.length > 0 && key.length <= 200 && !["__proto__", "constructor", "prototype"].includes(key) && !key.startsWith("$") &&
        (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || check(v, depth + 1)));
  }
  if (!check(metadataFilter, 0) || JSON.stringify(metadataFilter).length > 4000)
    throw new Error("Use um objeto JSON de até 4.000 caracteres no filtro de metadados, com valores simples ou objetos aninhados, sem operadores ou listas.");
  return { topK, minScore, distanceStrategy, metadataFilter: metadataFilter as Record<string, unknown> };
}

export function matchesMetadata(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => Object.hasOwn(metadata, key) && (
    value && typeof value === "object"
      ? !!metadata[key] && typeof metadata[key] === "object" && !Array.isArray(metadata[key]) && matchesMetadata(metadata[key] as Record<string, unknown>, value as Record<string, unknown>)
      : metadata[key] === value
  ));
}

/** Search-only edits do not change the vectors already published. */
export function indexingConfigIdentity(config: IndexConfig) {
  const normalized = structuredClone(config);
  delete normalized.retrieval;
  normalized.embeddings.batchSize ??= 32;
  normalized.embeddings.timeout ??= 120000;
  normalized.embeddings.stripNewLines = !!normalized.embeddings.stripNewLines;
  normalized.vectorStore.options ??= {};
  normalized.recordManager.namespace ||= "agentflows";
  normalized.recordManager.tableName ||= "agentflows_records";
  normalized.recordManager.cleanup ??= "full";
  normalized.recordManager.sourceIdKey ||= undefined;
  return JSON.stringify(normalized);
}
