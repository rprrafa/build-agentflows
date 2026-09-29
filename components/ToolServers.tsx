"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "./StudioUI";
import { ToolCard } from "./ToolCard";
export type ToolServer = { prefixo: string; nome: string; url: string; autorizado: boolean };
export function ServerSettings({ server, onSaved, onDeleted, onCancel }: {
  server?: ToolServer; onSaved: (server: ToolServer) => void; onDeleted?: () => void; onCancel?: () => void;
}) {
  const [draft, setDraft] = useState({ nome: server?.nome || "", url: server?.url || "", codigo: "" });
  const [busy, setBusy] = useState(false), [removing, setRemoving] = useState(false), [error, setError] = useState("");
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await request<ToolServer>(server ? `/api/conexoes/mcp/${server.prefixo}` : "/api/conexoes/mcp", server ? "PUT" : "POST", draft);
      const saved = server ? { ...server, nome: draft.nome.trim(), url: new URL(draft.url).toString(), autorizado: !!draft.codigo || (server.url === new URL(draft.url).toString() && server.autorizado) } : { ...result, autorizado: !!draft.codigo };
      if (!mounted.current) return;
      setDraft({ nome: saved.nome, url: saved.url, codigo: "" });
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar o servidor. Tente novamente."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!server) return;
    setBusy(true); setError("");
    try { await request(`/api/conexoes/mcp/${server.prefixo}`, "DELETE"); onDeleted?.(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível excluir o servidor."); }
    finally { setBusy(false); }
  }
  return <div className="tool-server-settings">
    <p>{server ? "Esta conexão é compartilhada. Alterações valem para todos os agentes que a utilizam." : "Cadastre a conexão e escolha as ações disponíveis para este agente."}</p>
    <label>Nome do servidor<input disabled={busy} value={draft.nome} maxLength={60} placeholder="Ex.: CRM comercial" onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></label>
    <label>Endereço do servidor<input disabled={busy} type="url" value={draft.url} placeholder="https://seu-servico/mcp" onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></label>
    <label>Código de acesso (opcional)<input disabled={busy} type="password" autoComplete="off" value={draft.codigo} placeholder={server ? "Em branco mantém a autorização" : "Ou autorize depois de salvar"} onChange={(e) => setDraft({ ...draft, codigo: e.target.value })} /></label>
    {error && <p className="studio-error" role="alert">{error}</p>}
    <div className="studio-actions">
      <button type="button" className="studio-button primary" disabled={busy || !draft.nome.trim() || !draft.url.trim()} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar conexão"}</button>
      {onCancel && <button type="button" className="studio-button" disabled={busy} onClick={onCancel}>Cancelar edição</button>}
    </div>
    {server && onDeleted && (removing ? <div className="tool-confirm"><p>Excluir esta conexão interrompe seu uso em todos os agentes.</p><div className="studio-actions">
      <button type="button" className="studio-button" disabled={busy} onClick={() => setRemoving(false)}>Manter conexão</button>
      <button type="button" className="studio-button danger" disabled={busy} onClick={() => void remove()}>Confirmar exclusão da conexão</button>
    </div></div> : <button type="button" className="tool-text-button" disabled={busy} onClick={() => setRemoving(true)}>Excluir conexão compartilhada</button>)}
  </div>;
}
// Página de retorno da autorização: mantém a gestão global fora do rascunho do agente.
export function ToolServers() {
  const [servers, setServers] = useState<ToolServer[]>([]), [adding, setAdding] = useState(false), [error, setError] = useState("");
  useEffect(() => { let alive = true; void request<ToolServer[]>("/api/conexoes/mcp").then((s) => { if (alive) setServers(s); }).catch(() => { if (alive) setError("Não foi possível consultar os servidores. Recarregue a página."); }); return () => { alive = false; }; }, []);
  function saved(server: ToolServer) { setServers((all) => [...all.filter((s) => s.prefixo !== server.prefixo), server]); setAdding(false); }
  return <div className="tool-servers">
    {error && <p className="studio-error" role="alert">{error}</p>}
    {servers.map((s) => <ToolCard key={s.prefixo} kind="mcp" title={s.nome} status={s.autorizado ? "Autorizado" : "Conferir conexão"}>
      <ServerSettings server={s} onSaved={saved} onDeleted={() => setServers((all) => all.filter((o) => o.prefixo !== s.prefixo))} />
      <a className="studio-button" href={`/api/conexoes/mcp/${s.prefixo}`}>{s.autorizado ? "Reautorizar" : "Autorizar"}</a>
    </ToolCard>)}
    {adding ? <ToolCard kind="mcp" title="Novo servidor MCP" status="Preencha a conexão"><ServerSettings onSaved={saved} onCancel={() => setAdding(false)} /></ToolCard>
      : <button type="button" className="studio-button" onClick={() => setAdding(true)}>Adicionar servidor MCP</button>}
  </div>;
}
