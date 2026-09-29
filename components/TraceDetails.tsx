"use client";
import type { Trace } from "@/lib/flow-types";
import { Icon, Modal } from "./StudioUI";
import { MarkdownContent } from "./MarkdownContent";
export function traceDuration(ms: number) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`; }
const statusLabel = (trace: Trace) => trace.status === "running" ? "Em execução" : trace.status === "failed" ? "Falhou" : "Concluída";
export function TraceRow({ trace, onOpen }: { trace: Trace; onOpen: () => void }) {
  return <button type="button" className="trace-row" onClick={onOpen} aria-label={`Ver detalhes: ${trace.label}`}>
    <span className={`timeline-check ${trace.status || "completed"}`}><Icon name={trace.status === "failed" ? "close" : trace.status === "running" ? "history" : "check"} size={12} /></span>
    <strong>{trace.label}</strong><small>{trace.status === "running" ? "Em execução" : `${trace.status === "failed" ? "Falhou · " : ""}${traceDuration(trace.ms)}`}</small><Icon name="expand" size={14} />
  </button>;
}
function Payload({ text, empty }: { text?: string; empty: string }) {
  if (text === undefined) return <p className="trace-empty">{empty}</p>;
  let json: string | undefined;
  try { json = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  if (json !== undefined) return <pre className="trace-json">{json}</pre>;
  return text ? <MarkdownContent>{text}</MarkdownContent> : <p className="trace-empty">Conteúdo vazio.</p>;
}
export function TraceDetails({ trace, isModel, onClose }: { trace: Trace; isModel: boolean; onClose: () => void }) {
  const count = (value: number) => value.toLocaleString("pt-BR");
  return <Modal title={trace.label} onClose={onClose} wide className="trace-dialog">
    <div className="trace-metrics">
      <div><span>Status</span><strong>{statusLabel(trace)}</strong></div>
      <div><span>Tempo</span><strong>{trace.status === "running" ? "Em andamento" : traceDuration(trace.ms)}</strong></div>
      <div><span>Tokens{trace.usage?.partial ? " (parcial)" : ""}</span><strong>{trace.usage ? count(trace.usage.total) : trace.type === "tool" || !isModel ? "Não se aplica" : "Não informado"}</strong></div>
    </div>
    {trace.usage ? <div className="trace-token-breakdown"><span>Entrada: <strong>{count(trace.usage.input)}</strong></span><span>Saída: <strong>{count(trace.usage.output)}</strong></span>{trace.usage.cachedInput !== undefined && <span>Em cache: <strong>{count(trace.usage.cachedInput)}</strong></span>}{trace.usage.reasoning !== undefined && <span>Raciocínio: <strong>{count(trace.usage.reasoning)}</strong></span>}</div> : trace.type === "tool" ? <p className="trace-note">O consumo de tokens fica na etapa do agente que chamou esta ferramenta.</p> : isModel ? <p className="trace-note">O consumo não foi informado pelo provedor ou não foi registrado nesta execução.</p> : null}
    {!!trace.knowledge?.available?.length && <section className="trace-knowledge">
      <h3>Bases disponíveis como ferramentas</h3>
      <p>O modelo recebeu estas bases e suas descrições. As chamadas realizadas aparecem separadamente nas etapas da execução.</p>
      <ul>{trace.knowledge.available.map(base => <li key={base.baseId}><strong>{base.baseName}</strong><small>{base.description}</small></li>)}</ul>
      <p>{trace.knowledge.count} trecho(s) recuperado(s) em {trace.knowledge.bases?.length || 0} base(s).</p>
    </section>}
    <div className="trace-payloads">
      <section><h3>Entrada</h3><Payload text={trace.input} empty="Entrada não registrada nesta execução." /></section>
      <section><h3>Saída</h3><Payload text={trace.output} empty="Aguardando resultado…" /></section>
    </div>
    {trace.instructions && <details className="trace-instructions"><summary>Instruções do agente</summary><pre>{trace.instructions}</pre></details>}
  </Modal>;
}
