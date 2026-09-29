"use client";
import { useId } from "react";
import { MEMORY_DEFAULTS, MEMORY_TYPES } from "@/lib/memory-settings";

export function MemoryFields({ config, onChange }: {
  config: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const id = useId();
  const enabled = (config.memoryEnabled ?? MEMORY_DEFAULTS.memoryEnabled) === "true";
  const type = config.memoryType ?? MEMORY_DEFAULTS.memoryType;
  return <section className="node-memory" aria-label="Memória do bloco">
    <div className="node-memory-heading">
      <span className="field-title" id={`${id}-label`}>Ativar memória</span>
      <button type="button" className="node-memory-switch" role="switch" aria-checked={enabled} aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} onClick={() => onChange("memoryEnabled", String(!enabled))}>
        <span />
      </button>
    </div>
    <small id={`${id}-help`}>{enabled ? "Inclui o contexto da conversa e dos agentes anteriores." : "Usa só as instruções, a mensagem desta etapa e os anexos."}</small>
    {enabled && <div className="node-memory-options">
      <label htmlFor={`${id}-type`}>Tipo de memória</label>
      <select id={`${id}-type`} aria-describedby={`${id}-description`} value={type} onChange={(event) => onChange("memoryType", event.target.value)}>
        {MEMORY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <small id={`${id}-description`}>{MEMORY_TYPES.find((option) => option.value === type)?.help}</small>
      {type === "windowSize" && <label>Quantidade de mensagens anteriores
        <input type="number" min={1} max={1000} step={1} value={config.memoryWindowSize ?? MEMORY_DEFAULTS.memoryWindowSize} onChange={(event) => onChange("memoryWindowSize", event.target.value)} />
      </label>}
      {type === "conversationSummaryBuffer" && <label>Limite aproximado de tokens
        <input type="number" min={100} max={128000} step={1} value={config.memoryMaxTokens ?? MEMORY_DEFAULTS.memoryMaxTokens} onChange={(event) => onChange("memoryMaxTokens", event.target.value)} />
        <small>Acima deste valor, as mensagens antigas são resumidas. A mensagem desta etapa é preservada.</small>
      </label>}
    </div>}
  </section>;
}
