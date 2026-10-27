"use client";
import type { Kind, Trace } from "@/lib/flow-types";
import { formatCost, traceCost } from "@/lib/token-usage";
import { MEDIA_PROVIDERS, mediaModel } from "@/lib/media-models";
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
function pretty(text: string) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
// Troca da etapa: só os papéis em negrito e o conteúdo como texto puro, sem formatação.
function Turns({ turns, notes }: { turns: NonNullable<Trace["turns"]>; notes?: string }) {
  return <>
    <div className="trace-turns">{turns.map((turn, i) => <div key={i}><strong>{turn.role === "user" ? "Usuário" : "Assistente"}</strong><pre className="trace-plain">{turn.content || "(vazio)"}</pre></div>)}</div>
    {notes && <p className="trace-note">{notes}</p>}
  </>;
}
function Payload({ text, empty }: { text?: string; empty: string }) {
  if (text === undefined) return <p className="trace-empty">{empty}</p>;
  let json: string | undefined;
  try { json = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  if (json !== undefined) return <pre className="trace-json">{json}</pre>;
  return text ? <MarkdownContent>{text}</MarkdownContent> : <p className="trace-empty">Conteúdo vazio.</p>;
}
export function TraceDetails({ trace, kind, onClose }: { trace: Trace; kind?: Kind; onClose: () => void }) {
  const count = (value: number) => value.toLocaleString("pt-BR");
  const isModel = kind === "agent" || kind === "llm";
  const cost = traceCost(trace);
  return <Modal title={trace.label} onClose={onClose} wide className="trace-dialog">
    <div className={cost === undefined ? "trace-metrics" : "trace-metrics with-cost"}>
      <div><span>Status</span><strong>{statusLabel(trace)}</strong></div>
      <div><span>Tempo</span><strong>{trace.status === "running" ? "Em andamento" : traceDuration(trace.ms)}</strong></div>
      <div><span>Tokens{trace.usage?.partial ? " (parcial)" : ""}</span><strong>{trace.usage ? count(trace.usage.total) : trace.type === "tool" || !isModel || trace.media?.length ? "Não se aplica" : "Não informado"}</strong></div>
      {cost !== undefined && <div><span>Custo{trace.usage?.partial ? " (parcial)" : ""}</span><strong title="Valor informado pelo provedor">{formatCost(cost)}</strong></div>}
    </div>
    {trace.skill ? <p className="trace-note">{trace.skill.repeated ? "Conteúdo já carregado nesta etapa: o modelo recebeu só um aviso curto, sem repetir as instruções" : `Conteúdo entregue ao modelo: ≈ ${count(trace.skill.tokens)} tokens (estimativa de 4 caracteres por token)`}. O consumo real fica na etapa do agente que carregou a habilidade.</p> : trace.usage ? <div className="trace-token-breakdown"><span>Entrada: <strong>{count(trace.usage.input)}</strong></span><span>Saída: <strong>{count(trace.usage.output)}</strong></span>{trace.usage.cachedInput !== undefined && <span>Em cache: <strong>{count(trace.usage.cachedInput)}</strong></span>}{trace.usage.reasoning !== undefined && <span>Raciocínio: <strong>{count(trace.usage.reasoning)}</strong></span>}</div> : trace.type === "tool" ? <p className="trace-note">O consumo de tokens fica na etapa do agente que chamou esta ferramenta.</p> : trace.media?.length ? null : isModel ? <p className="trace-note">O consumo não foi informado pelo provedor ou não foi registrado nesta execução.</p> : null}
    {!!trace.media?.length && <p className="trace-note">{trace.media.map((request) => <span key={request.requestId}>{MEDIA_PROVIDERS.find((provider) => provider.id === request.provider)?.name} · {mediaModel(request.model)?.name || request.model} · solicitação <code>{request.requestId}</code>. </span>)}{cost === undefined ? "O provedor não informa o valor pela API; consulte a cobrança no painel dele com este identificador." : ""}</p>}
    {!!trace.knowledge?.available?.length && <section className="trace-knowledge">
      <h3>{kind === "retriever" ? "Bases consultadas pelo bloco" : "Bases disponíveis como ferramentas"}</h3>
      <p>{kind === "retriever" ? "A consulta foi feita em todas estas bases; na análise agêntica, o modelo pôde refazê-la. Cada consulta aparece separadamente nas etapas da execução." : "O modelo recebeu estas bases e suas descrições. As chamadas realizadas aparecem separadamente nas etapas da execução."}</p>
      <ul>{trace.knowledge.available.map(base => <li key={base.baseId}><strong>{base.baseName}</strong><small>{base.description}</small></li>)}</ul>
      <p>{trace.knowledge.count} trecho(s) recuperado(s) em {trace.knowledge.bases?.length || 0} base(s).</p>
    </section>}
    {trace.skills && <section className="trace-knowledge trace-skills">
      <h3>Habilidades</h3>
      <p>O modelo recebeu o nome e a descrição de cada habilidade (≈ {count(trace.skills.catalogTokens)} tokens em cada chamada) e carregou o conteúdo só quando precisou. Valores estimados; o consumo real está em Tokens.</p>
      <ul>{trace.skills.available.map(skill => {
        const loads = trace.skills!.loaded.filter(load => load.name === skill.name);
        return <li key={skill.name}><strong>{skill.name}</strong><small>{loads.length ? "Carregada: " + loads.map(load => `${load.file || "SKILL.md"}${load.start ? ` (a partir de ${count(load.start)})` : ""} ≈ ${count(load.tokens)} tokens`).join(" · ") : "Não carregada nesta etapa"}</small></li>;
      })}</ul>
    </section>}
    {trace.instructions && <details className="trace-instructions"><summary>{kind === "agent" ? "Instruções do agente" : kind === "retriever" ? "Instruções da análise" : "Instruções"}</summary><pre>{trace.instructions}</pre></details>}
    {trace.memory && <details className="trace-instructions trace-memory"><summary>Memória</summary><pre>{pretty(trace.memory)}</pre></details>}
    <div className="trace-payloads">
      <section><h3>Entrada</h3>{trace.turns?.length ? <Turns turns={trace.turns} notes={trace.notes} /> : <><Payload text={trace.input} empty="Entrada não registrada nesta execução." />{trace.notes && <p className="trace-note">{trace.notes}</p>}</>}</section>
      <section><h3>Saída</h3><Payload text={trace.output} empty="Aguardando resultado…" /></section>
    </div>
  </Modal>;
}
