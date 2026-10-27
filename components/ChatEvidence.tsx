"use client";
import { useState } from "react";
import { toolTitle } from "@/lib/tool-presentation";
import type { Run } from "@/lib/flow-types";
import { chatReferences, referenceUrl, type KnowledgeReference } from "@/lib/knowledge-references";
import { Icon, Modal } from "./StudioUI";
import { MarkdownContent } from "./MarkdownContent";
import { traceDuration } from "./TraceDetails";
import type { Trace } from "@/lib/flow-types";

const SKILL_PREFIX = "Habilidade: ";
const isSkillTrace = (trace: Trace) => trace.type === "tool" && (!!trace.skill || trace.label.startsWith(SKILL_PREFIX));
const approxTokens = (value: number) => `≈ ${value.toLocaleString("pt-BR")} tokens`;

export function ChatEvidence({ run, onOpenTool }: { run: Run; onOpenTool: (index: number) => void }) {
  const [selected, setSelected] = useState<KnowledgeReference | null>(null);
  const { text, chunks } = chatReferences(run.output, run.trace.flatMap(trace => trace.knowledge ? [trace.knowledge] : []));
  const tools = run.trace.flatMap((trace, index) => !isSkillTrace(trace) && (trace.type === "tool" || run.graph.nodes.some(node => node.id === trace.nodeId && node.data.kind === "tool")) ? [{ trace, index }] : []);
  // Habilidades carregadas sob demanda: cada carregamento com a estimativa de tokens do conteúdo entregue ao modelo.
  const skills = run.trace.flatMap((trace, index) => isSkillTrace(trace) ? [{ trace, index }] : []);
  const catalogTokens = run.trace.reduce((sum, trace) => sum + (trace.skills?.catalogTokens || 0), 0);
  const loadedTokens = skills.reduce((sum, { trace }) => sum + (trace.status === "completed" && !trace.skill?.repeated ? trace.skill?.tokens || 0 : 0), 0);
  const url = referenceUrl(selected?.source);
  return <>
    <MarkdownContent>{text || (run.status === "running" ? "Pensando…" : "Sem resposta.")}</MarkdownContent>
    {!!chunks.length && <section className="chat-evidence" aria-label="Referências">
      <h3>Referências <span>{chunks.length}</span></h3>
      <div className="chat-evidence-badges">{chunks.map((chunk, index) => <button type="button" className="chat-evidence-badge" key={JSON.stringify([chunk.baseId, chunk.id, chunk.pageContent])} onClick={() => setSelected(chunk)} title={`${chunk.baseName} · ${chunk.sourceName} · Chunk ${chunk.ordinal}`} aria-label={`Abrir referência ${index + 1}: ${chunk.sourceName}, chunk ${chunk.ordinal}`}>
        <Icon name="book" size={13} /><span className="chat-evidence-number">{index + 1}</span><span className="chat-evidence-label">{chunk.sourceName}</span><Icon name="expand" size={12} />
      </button>)}</div>
    </section>}
    {!!skills.length && <section className="chat-evidence" aria-label="Habilidades carregadas">
      <h3>Habilidades carregadas <span>{skills.length}</span></h3>
      <div className="chat-evidence-badges">{skills.map(({ trace, index }) => {
        const status = trace.status === "running" ? "Em execução" : trace.status === "failed" ? "Falhou" : trace.skill?.repeated ? "Já carregada" : "Carregada";
        const detail = trace.status === "completed" && trace.skill ? (trace.skill.repeated ? "repetida" : approxTokens(trace.skill.tokens)) : status;
        return <button type="button" className={`chat-evidence-badge ${trace.status || "completed"}`} key={index} onClick={() => onOpenTool(index)} title={`${trace.label} · ${status}`} aria-label={`Ver ${trace.label} · ${status} · ${detail}`}>
          <Icon name="skill" size={13} /><span className="chat-evidence-label">{trace.label.slice(SKILL_PREFIX.length)}</span><span className="chat-evidence-tokens">{detail}</span><Icon name={trace.status === "failed" ? "close" : trace.status === "running" ? "history" : "check"} size={12} />
        </button>;
      })}</div>
      <p className="trace-note">Estimativa: {approxTokens(loadedTokens)} carregados sob demanda{catalogTokens ? ` e ${approxTokens(catalogTokens)} de catálogo (nomes e descrições) em cada chamada ao modelo` : ""}. O consumo real fica em Tokens, nas etapas executadas.</p>
    </section>}
    {!!tools.length && <section className="chat-evidence" aria-label="Ferramentas utilizadas">
      <h3>Ferramentas utilizadas <span>{tools.length}</span></h3>
      <div className="chat-evidence-badges">{tools.map(({ trace, index }, call) => {
        const status = trace.status === "running" ? "Em execução" : trace.status === "failed" ? "Falhou" : "Concluída";
        return <button type="button" className={`chat-evidence-badge ${trace.status || "completed"}`} key={index} onClick={() => onOpenTool(index)} title={`${trace.label} · ${status} · ${traceDuration(trace.ms)}`} aria-label={`Ver chamada ${call + 1}: ${trace.label} · ${status}`}>
          <Icon name="tool" size={13} /><span className="chat-evidence-label">{trace.label.startsWith("Ferramenta: ") ? toolTitle({ name: trace.label.slice(12) }) : trace.label}</span><Icon name={trace.status === "failed" ? "close" : trace.status === "running" ? "history" : "check"} size={12} />
        </button>;
      })}</div>
    </section>}
    {selected && <Modal title={`Chunk ${selected.ordinal}`} onClose={() => setSelected(null)} wide className="chunk-reference-dialog">
      <dl className="chunk-reference-info">
        <div><dt>Base de conhecimento</dt><dd>{selected.baseName}</dd></div>
        <div><dt>Documento</dt><dd>{selected.sourceName}</dd></div>
        {selected.page !== undefined && <div><dt>Página</dt><dd>{selected.page}</dd></div>}
        {selected.source && selected.source !== "Texto adicionado" && <div><dt>Origem</dt><dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{selected.source}<Icon name="link" size={12} /></a> : selected.source}</dd></div>}
      </dl>
      <h3 className="chunk-reference-heading">Conteúdo completo</h3>
      <pre className="chunk-reference-content">{selected.pageContent}</pre>
    </Modal>}
  </>;
}
