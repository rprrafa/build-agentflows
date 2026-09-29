"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Generated, GenerationEvent, GenerationPhase } from "@/lib/flow-generator";
import type { FlowContext, FlowMessage } from "@/lib/flow-ai-edit";
import { NODE_STYLE } from "@/lib/flow-presets";
import { Icon, Modal } from "./StudioUI";

const WAITING_MESSAGES = ["A IA está preparando seu fluxo.", "A descrição orienta os blocos e as instruções de cada agente.", "Fluxos mais detalhados podem levar um pouco mais de tempo.", "Os blocos aparecerão aqui quando a geração terminar."];
const PHASE_LABELS = {
  interpreting: "Interpretando sua descrição…",
  planning: "Planejando o fluxo e as instruções…",
  creating: "Criando os blocos e as conexões…",
  repairing: "Ajustando os blocos e as conexões…",
  complete: "Fluxo concluído",
};

export function GeneratorDialog({ flowId, context, messages, onMessages, replaces, connected, onConnect, onClose, onApply }: {
  flowId: string; context: FlowContext; messages: FlowMessage[]; onMessages: (messages: FlowMessage[]) => void; replaces: boolean; connected: boolean; onConnect: () => void;
  onClose: () => void; onApply: (g: Generated, mode: "new" | "edit") => void;
}) {
  const [mode, setMode] = useState<"new" | "edit">(replaces || messages.length ? "edit" : "new");
  const conversationEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => { conversationEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages]);
  const [prompt, setPrompt] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<GenerationPhase>("interpreting");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Generated | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  async function generate() {
    if (pending.current || !prompt.trim() || !connected) return;
    const controller = new AbortController();
    pending.current = controller;
    setElapsed(0); setBusy(true); setError(""); setPhase("interpreting");
    try {
      const response = await fetch(`/api/flows/${flowId}/generate`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ prompt: prompt.trim(), mode: result ? "edit" : mode, context: result || context, history: messages.slice(-12) }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Não foi possível gerar o fluxo.");
      if (!response.body) throw new Error("Não foi possível acompanhar a geração. Tente novamente.");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "", generated: Generated | null = null;
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as GenerationEvent;
        if ("error" in event) throw new Error(event.error);
        if ("phase" in event) setPhase(event.phase);
        if ("result" in event) generated = event.result;
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          lines.forEach(receive);
          if (done) { receive(buffer); break; }
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      if (!generated) throw new Error("A geração foi interrompida. Tente novamente.");
      if (!controller.signal.aborted) {
        const completed = generated as Generated;
        setResult(completed);
        const nextMessages: FlowMessage[] = [...messages, { role: "user", content: prompt.trim() }, { role: "assistant", content: completed.summary || `Criei o fluxo ${completed.name}. Você pode pedir mais ajustes ou aplicar ao canvas.` }];
        onMessages(nextMessages.slice(-40));
        setPrompt("");
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível gerar o fluxo.");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const current = phase === "interpreting" ? 0 : phase === "planning" ? 1 : 2;
  const changed = result && JSON.stringify({ name: result.name, description: result.description, graph: result.graph }) !== JSON.stringify(context);
  return (
    <Modal title="Fluxo com IA" className="generator-dialog" onClose={() => { pending.current?.abort(); onClose(); }}>
      <div className="generator-modes" aria-label="Modo da IA">
        {([ ["new", "Criar do zero"], ["edit", "Editar fluxo atual"] ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => {
            if (mode === value) return;
            setMode(value); setResult(null); setError(""); setPrompt(""); onMessages([]);
          }}>{label}</button>
        ))}
      </div>
      <p className="generator-context">{mode === "edit" ? "Peça ajustes no fluxo atual, incluindo o que ainda não foi salvo." : "Descreva um novo fluxo e refine a proposta conversando com a IA."} As mudanças só entram no canvas ao aplicar.</p>
      {messages.length > 0 && <div className="generator-conversation" role="log" aria-label="Conversa com a IA">
        {messages.map((message, index) => <div key={index} className={"generator-message " + message.role}><small>{message.role === "user" ? "Você" : "IA"}</small><p>{message.content}</p></div>)}
        <div ref={conversationEnd} />
      </div>}
      {busy && (
        <div className="generator-journey" aria-busy="true">
          <div className="generator-mini-flow" aria-hidden="true">
            {(["start", "agent", "end"] as const).map((kind, index) => (
              <span key={kind} className="generator-mini-node" style={{ "--step": index } as CSSProperties}><Icon name={kind} size={24} /></span>
            ))}
          </div>
          <strong className="generator-phase" role="status">{PHASE_LABELS[phase]}</strong>
          <div className="generator-waiting"><p role="status" key={Math.floor(elapsed / 6)}>{WAITING_MESSAGES[Math.floor(elapsed / 6) % WAITING_MESSAGES.length]}</p><small>Tempo decorrido: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</small></div>
          <ol className="generator-steps" aria-label="Etapas da geração">
            {["Interpretação", "Planejamento", "Blocos e conexões"].map((label, index) => (
              <li key={label} className={index < current ? "done" : index === current ? "active" : ""} aria-current={index === current ? "step" : undefined}>
                <span>{index < current ? <Icon name="check" size={12} /> : index + 1}</span>{label}
              </li>
            ))}
          </ol>
        </div>
      )}
      {result && !busy && <div className="generator-summary">
        <strong>Prévia · {result.name || "Fluxo sem nome"}</strong>
        <p>{result.graph.nodes.length} blocos · {result.graph.edges.length} conexões</p>
        <div className="preset-chain">{result.graph.nodes.map((node) => (
          <span key={node.id} title={node.data.label} style={{ background: NODE_STYLE[node.data.kind].color }}><Icon name={node.data.kind} size={20} /></span>
        ))}</div>
        {changed ? <>
          {mode === "new" && replaces && <p className="generator-warning">Ao aplicar, esta proposta substituirá os blocos atuais. Você pode desfazer antes de salvar.</p>}
          <div className="modal-actions"><button type="button" className="studio-button primary" onClick={() => { onApply(result, mode); onClose(); }}><Icon name="check" size={16} />{mode === "edit" ? "Aplicar ajustes" : "Colocar no quadro"}</button></div>
        </> : <p>Nenhuma alteração para aplicar. Continue a conversa abaixo.</p>}
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <div className="node-fields">
          <textarea aria-label={mode === "new" && !result ? "Descrição do fluxo" : "Mensagem para a IA"} autoFocus rows={messages.length ? 3 : 5} maxLength={4000} value={prompt} disabled={busy}
            placeholder={result ? "O que mais você quer ajustar nesta proposta?" : mode === "edit" ? "Ex.: faça o agente responder de forma mais breve e adicione uma aprovação antes do envio." : "Descreva o processo. A IA desenha os blocos, as conexões e as instruções de cada agente."}
            onChange={(event) => setPrompt(event.target.value)} />
        </div>
        {error && <p className="studio-error" role="alert">{error}</p>}
        {!connected && <p className="generator-warning">Conecte o ChatGPT ou o OpenRouter para conversar com a IA. <button type="button" onClick={onConnect}>Conectar</button></p>}
        <div className="modal-actions">
          <button type="submit" className="studio-button" disabled={busy || !prompt.trim() || !connected}><Icon name="spark" size={16} />{busy ? "Preparando…" : mode === "new" && !result ? "Gerar Fluxo" : "Enviar ajuste"}</button>
        </div>
      </form>
    </Modal>
  );
}
