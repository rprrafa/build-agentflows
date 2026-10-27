"use client";
import { KnowledgeAgentFields } from "./KnowledgeAgentFields";
import { ModelPicker } from "./ModelPicker";
import { ReferenceField, type Reference } from "./ReferenceField";
import { RETRIEVER_ANALYSES, RETRIEVER_FORMATS, RETRIEVER_SYSTEM, retrieverAgentic } from "@/lib/flow-retriever";
// Campos do bloco Base de conhecimento, na ordem do Retriever do Flowise: bases, consulta e formato;
// a análise agêntica acrescenta o modelo e as instruções de quem avalia os trechos.
export function RetrieverFields({ config, references, models, connected, onConnect, onChange }: {
  config: Record<string, string>;
  references: Reference[];
  models: { id: string; name: string }[];
  connected: boolean;
  onConnect: () => void;
  onChange: (values: Record<string, string>) => void;
}) {
  const agentic = retrieverAgentic(config);
  return <>
    <KnowledgeAgentFields retriever config={config} onChange={(key, value) => onChange({ [key]: value })} />
    <div className="node-field">
      <span className="field-title">Consulta <span aria-hidden="true">*</span></span>
      <ReferenceField multiline rows={3} ariaLabel="Consulta" spellCheck value={config.query || ""} references={references}
        placeholder="Ex.: {{Conversa}} ou o que buscar nas bases" onChange={(query) => onChange({ query })} />
      <small>Texto buscado em cada base. Use {"{{Conversa}}"} para a mensagem recebida ou {"{{Etapa anterior}}"} para o resultado anterior.</small>
    </div>
    <label className="node-field">
      <span className="field-title">Formato do resultado</span>
      <select aria-label="Formato do resultado" value={config.outputFormat || "text"} onChange={(e) => onChange({ outputFormat: e.target.value })}>
        {RETRIEVER_FORMATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <small>Texto lista os trechos (ou a análise) com as referências. JSON traz a consulta, a análise e cada trecho com base, fonte e similaridade.</small>
    </label>
    <label className="node-field">
      <span className="field-title">Análise dos trechos</span>
      <select aria-label="Análise dos trechos" value={config.analysis || ""} onChange={(e) => onChange({ analysis: e.target.value, ...(e.target.value && !config.system?.trim() ? { system: RETRIEVER_SYSTEM } : {}) })}>
        {RETRIEVER_ANALYSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <small>{agentic ? "Um modelo de IA avalia os trechos, pode refazer consultas nas mesmas bases com outros termos e devolve a análise no lugar dos trechos." : "Devolve os trechos encontrados, sem chamar um modelo de IA."}</small>
    </label>
    {agentic && <>
      <div className="node-field">
        <span className="field-title">Modelo da análise</span>
        <ModelPicker value={config.model || ""} kind="retriever" chatModels={models} connected={connected} config={config} onConfigChange={onChange} onConnect={onConnect} />
      </div>
      <div className="node-field">
        <span className="field-title">Instruções da análise</span>
        <ReferenceField multiline rows={5} ariaLabel="Instruções da análise" spellCheck value={config.system || ""} references={references} onChange={(system) => onChange({ system })} />
        <small>Como avaliar os trechos e o que entregar. A consulta e os trechos chegam ao modelo como dados.</small>
      </div>
    </>}
  </>;
}
