export type KnowledgeBinding = {
  baseId: string;
  description: string;
  references: boolean;
  topK?: number;
  minScore?: number;
};
export const MAX_KNOWLEDGE_BASES = 10;
export const MAX_KNOWLEDGE_DESCRIPTION = 1000;

function validateLimits(topK?: number, minScore?: number) {
  if (
    (topK !== undefined && (!Number.isInteger(topK) || topK < 1 || topK > 20)) ||
    (minScore !== undefined && (typeof minScore !== "number" || !Number.isFinite(minScore) || minScore < -1 || minScore > 1))
  ) throw new Error("Use de 1 a 20 resultados e pontuação entre -1 e 1 para a base de conhecimento.");
}

export function knowledgeSettings(config: Record<string, string>) {
  // An explicit empty array removes every binding, including a legacy selection.
  if (config.knowledgeBases !== undefined) {
    let rows: unknown;
    try { rows = JSON.parse(config.knowledgeBases); } catch { throw new Error("Confira a lista de bases de conhecimento."); }
    if (!Array.isArray(rows) || rows.length > MAX_KNOWLEDGE_BASES || config.knowledgeBases.length > 20000)
      throw new Error(`Adicione até ${MAX_KNOWLEDGE_BASES} bases de conhecimento por bloco.`);
    const seen = new Set<string>();
    const bases: KnowledgeBinding[] = rows.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.baseId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.baseId))
        throw new Error(`Selecione a base de conhecimento ${index + 1}.`);
      if (seen.has(row.baseId)) throw new Error("Selecione cada base de conhecimento apenas uma vez por bloco.");
      seen.add(row.baseId);
      if (typeof row.description !== "string" || !row.description.trim() || row.description.length > MAX_KNOWLEDGE_DESCRIPTION)
        throw new Error(`Descreva quando consultar a base ${index + 1}, em até ${MAX_KNOWLEDGE_DESCRIPTION} caracteres.`);
      if (typeof row.references !== "boolean") throw new Error("Escolha se deseja retornar as referências de cada base.");
      validateLimits(row.topK, row.minScore);
      return { baseId: row.baseId, description: row.description.trim(), references: row.references, topK: row.topK, minScore: row.minScore };
    });
    return { bases, legacy: false, baseId: "", references: false, topK: undefined, minScore: undefined };
  }
  const baseId = config.knowledgeBase || "";
  if (baseId && !/^[a-zA-Z0-9_-]{1,80}$/.test(baseId)) throw new Error("Escolha uma base de conhecimento válida.");
  if (config.knowledgeReferences && !["true", "false"].includes(config.knowledgeReferences))
    throw new Error("Escolha se deseja retornar as referências.");
  const topK = config.knowledgeTopK ? Number(config.knowledgeTopK) : undefined;
  const minScore = config.knowledgeMinScore ? Number(config.knowledgeMinScore) : undefined;
  validateLimits(topK, minScore);
  const references = config.knowledgeReferences === "true";
  return {
    baseId, references, topK, minScore, legacy: true,
    bases: baseId ? [{ baseId, description: "", references, topK, minScore }] : [],
  };
}

/** Includes old flows and new cards; used to protect draft and published references. */
export function knowledgeBaseIds(config: Record<string, string>): string[] {
  return knowledgeSettings(config).bases.map(row => row.baseId);
}
