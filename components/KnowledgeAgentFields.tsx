"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { KNOWLEDGE_STATUS, type KnowledgeBase } from "@/lib/knowledge-types";
import { knowledgeSettings, MAX_KNOWLEDGE_BASES, MAX_KNOWLEDGE_DESCRIPTION, type KnowledgeBinding } from "@/lib/knowledge-settings";
import { ToolSelect } from "./ToolSelect";
import { Icon, IconButton, request } from "./StudioUI";
export function KnowledgeAgentFields({ config, onChange }: {
  config: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const fieldId = useId();
  const [bases, setBases] = useState<KnowledgeBase[]>([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const refreshOnFocus = () => setRefresh(value => value + 1);
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);
  useEffect(() => {
    let active = true;
    void request<KnowledgeBase[]>("/api/knowledge")
      .then(data => { if (active) { setBases(data); setLoaded(true); setError(""); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refresh]);
  let rows: KnowledgeBinding[] = [], invalid = false;
  try {
    if (config.knowledgeBases !== undefined) {
      const parsed = JSON.parse(config.knowledgeBases);
      if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row.baseId !== "string" || typeof row.description !== "string" || typeof row.references !== "boolean")) throw new Error();
      rows = parsed;
    } else rows = knowledgeSettings(config).bases.map(row => ({
      ...row,
      description: bases.find(base => base.id === row.baseId)?.description.slice(0, MAX_KNOWLEDGE_DESCRIPTION) || "Consulte esta base para responder perguntas sobre os documentos cadastrados nela.",
    }));
  } catch { invalid = true; }
  const save = (next: KnowledgeBinding[]) => onChange("knowledgeBases", JSON.stringify(next));
  const update = (index: number, values: Partial<KnowledgeBinding>) => save(rows.map((row, i) => i === index ? { ...row, ...values } : row));
  return (
    <section className="knowledge-agent node-fields" aria-label="Conhecimento do bloco">
      <div className="knowledge-section-title">
        <strong>Conhecimento</strong>
        <Link href="/knowledge" target="_blank" rel="noopener">Gerenciar bases</Link>
      </div>
      <small>Adicione bases e descreva quando cada uma deve ser consultada. A IA escolhe as bases relevantes para a pergunta.</small>
      {invalid && <p className="studio-error" role="alert">A lista de bases está inválida. Corrija a configuração do fluxo antes de continuar.</p>}
      {error && <p className="studio-error" role="alert">{error} <button type="button" onClick={() => setRefresh(refresh + 1)}>Tentar novamente</button></p>}
      {!loaded && !error && <small>Carregando bases…</small>}
      {loaded && !bases.length && <small>Crie uma base, adicione documentos e conclua a indexação para usá-la aqui.</small>}
      {rows.map((row, index) => {
        const selected = bases.find(base => base.id === row.baseId);
        const referencesId = `${fieldId}-references-${index}`;
        return <div className="agent-tool-block knowledge-binding-card" role="group" aria-label={`Base de conhecimento ${index + 1}`} key={index}>
          <div className="agent-tool-heading">
            <label>Base de conhecimento <span aria-hidden="true">*</span></label>
            <span>{index + 1}</span>
            <IconButton icon="trash" danger label={`Remover base ${index + 1} do bloco`} onClick={() => save(rows.filter((_, i) => i !== index))} />
          </div>
          <ToolSelect
            label={`Base de conhecimento ${index + 1}`}
            listLabel={`Bases de conhecimento ${index + 1}`}
            icon={<Icon name="book" size={24} />}
            catalog={bases.map(base => ({ id: base.id, name: `${base.name} · ${KNOWLEDGE_STATUS[base.status]}` }))}
            value={row.baseId}
            used={rows.filter((_, i) => i !== index).map(other => other.baseId)}
            disabled={!loaded}
            missingLabel="Base não encontrada · escolha outra"
            emptyMessage="Nenhuma base encontrada."
            onChange={baseId => {
              const base = bases.find(item => item.id === baseId);
              update(index, { baseId, description: base?.description.slice(0, MAX_KNOWLEDGE_DESCRIPTION) || "", topK: undefined, minScore: undefined });
            }}
          />
          {selected && selected.status !== "ready" && <small>Conclua a indexação desta base antes de consultá-la. <Link target="_blank" rel="noopener" href={`/knowledge/${selected.id}`}>Abrir base</Link></small>}
          <label>
            Descrição do conhecimento <span aria-hidden="true">*</span>
            <textarea aria-label={`Descrição do conhecimento ${index + 1}`} required rows={4} maxLength={MAX_KNOWLEDGE_DESCRIPTION} value={row.description} placeholder="Ex.: Políticas de cancelamento e reembolso. Consulte quando houver dúvidas sobre prazos, condições ou devolução de pagamentos." onChange={e => update(index, { description: e.target.value })} />
            <small>Explique o conteúdo, por que ele é útil e quando a IA deve buscar nesta base.</small>
          </label>
          <div className="knowledge-binding-references">
            <span id={referencesId}>Retornar documentos de origem<small>Acrescenta à resposta as referências encontradas nesta base.</small></span>
            <button type="button" role="switch" className="node-memory-switch" aria-labelledby={referencesId} aria-checked={row.references} onClick={() => update(index, { references: !row.references })}><span /></button>
          </div>
          <details>
            <summary>Ajustar consulta</summary>
            <small>Deixe em branco para usar os padrões da base. Filtros e estratégia de distância seguem a configuração da base.</small>
            <div className="knowledge-form-grid">
              <label>Top K<input aria-label={`Top K da base ${index + 1}`} type="number" min={1} max={20} placeholder={`Padrão: ${selected?.config.retrieval?.topK ?? 4}`} value={row.topK ?? ""} onChange={e => update(index, { topK: e.target.value ? Number(e.target.value) : undefined })} /></label>
              <label>Similaridade mínima<input aria-label={`Similaridade mínima da base ${index + 1}`} type="number" min={-1} max={1} step="0.05" placeholder={`Padrão: ${selected?.config.retrieval?.minScore ?? 0}`} value={row.minScore ?? ""} onChange={e => update(index, { minScore: e.target.value ? Number(e.target.value) : undefined })} /></label>
            </div>
          </details>
        </div>;
      })}
      <button type="button" className="studio-button tool-add-button" disabled={invalid || !loaded || !bases.length || rows.length >= MAX_KNOWLEDGE_BASES || rows.length >= bases.length} onClick={() => save([...rows, { baseId: "", description: "", references: false }])}>
        <Icon name="plus" size={16} />Adicionar base de conhecimento
      </button>
    </section>
  );
}
