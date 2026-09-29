"use client";
import type { IndexConfig, RetrievalConfig } from "@/lib/knowledge-types";
export function KnowledgeRetrievalFields({ config, onChange }: { config: IndexConfig; onChange: (value: RetrievalConfig) => void }) {
  const value = config.retrieval || { topK: 4, minScore: 0 };
  const change = (fields: Partial<RetrievalConfig>) => onChange({ ...value, ...fields });
  const filter = value.metadataFilter || {};
  return <section className="knowledge-retrieval-fields">
    <h3>Configuração da busca</h3>
    <p>Valores usados pelo teste e pelos agentes. Alterar a busca não exige reindexar os documentos.</p>
    <div className="knowledge-form-grid">
      <label>Top K<input type="number" min={1} max={20} required value={value.topK} onChange={e => change({ topK: Number(e.target.value) })} /><small>Máximo de trechos por consulta. Padrão: 4.</small></label>
      <label>Similaridade mínima<input type="number" min={-1} max={1} step="0.05" required value={value.minScore} onChange={e => change({ minScore: Number(e.target.value) })} /><small>Similaridade de cosseno, entre -1 e 1.</small></label>
    </div>
    {config.vectorStore.provider === "postgres" && <label>Estratégia de distância<select value={value.distanceStrategy || "cosine"} onChange={e => change({ distanceStrategy: e.target.value as RetrievalConfig["distanceStrategy"] })}>
      <option value="cosine">Cosseno</option><option value="euclidean">Euclidiana</option><option value="innerProduct">Produto interno</option>
    </select><small>Define a ordem dos resultados. A similaridade mínima continua sendo medida por cosseno.</small></label>}
    {["local", "faiss", "postgres"].includes(config.vectorStore.provider) && <label>Filtro de metadados (JSON)<textarea rows={4} maxLength={4000} spellCheck={false} placeholder={'{"categoria": "financeiro"}'} value={typeof filter === "string" ? filter : Object.keys(filter).length ? JSON.stringify(filter, null, 2) : ""} onChange={e => change({ metadataFilter: e.target.value })} /><small>Todos os campos devem corresponder. Aceita valores simples e objetos aninhados. Deixe vazio para consultar todos os documentos.</small></label>}
  </section>;
}
