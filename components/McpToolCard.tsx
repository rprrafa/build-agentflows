"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolGroup } from "@/lib/tools";
import { request } from "./StudioUI";
import { ToolCard } from "./ToolCard";
import { ServerSettings, type ToolServer } from "./ToolServers";
export function McpToolCard({ target, servers, used, selected, onTarget, onSelection, onServerSaved, onServerDeleted, onRemove }: {
  target: string; servers: ToolServer[]; used: string[]; selected: string[];
  onTarget: (target: string) => void; onSelection: (ids: string[]) => void;
  onServerSaved: (server: ToolServer) => void; onServerDeleted: (target: string) => void; onRemove: () => void;
}) {
  const server = servers.find((s) => s.prefixo === target);
  const [editing, setEditing] = useState(false), [creating, setCreating] = useState(false);
  const [group, setGroup] = useState<ToolGroup | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!target) return;
    setBusy(true); setError("");
    try {
      const groups = await request<ToolGroup[]>(`/api/tools?server=${encodeURIComponent(target)}`);
      if (current === generation.current) setGroup(groups[0] || null);
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Não foi possível listar as ações. Tente novamente."); }
    finally { if (current === generation.current) setBusy(false); }
  }, [target]);
  useEffect(() => {
    const invalidate = () => { generation.current++; };
    const timer = setTimeout(() => void refresh(), 0);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { clearTimeout(timer); invalidate(); window.removeEventListener("focus", focus); };
  }, [refresh]);
  const actions = group?.id === `mcp:${target}` ? group : null;
  const chosen = selected.filter((id) => id.startsWith(`mcp:${target}:`));
  const known = new Set(actions?.tools.map((t) => t.id));
  const unavailable = chosen.filter((id) => !known.has(id));
  function choose(id: string) {
    setCreating(id === "new"); setEditing(false); setGroup(null); setQuery(""); setError("");
    onTarget(id === "new" ? "" : id);
  }
  function saved(s: ToolServer) {
    onServerSaved(s); setCreating(false); setEditing(false);
    if (s.prefixo !== target) onTarget(s.prefixo);
    else void refresh();
  }
  const title = server?.nome || (target ? "Servidor indisponível" : "Novo servidor MCP");
  const problem = error || actions?.error;
  return <ToolCard kind="mcp" title={title} initiallyOpen={!target} status={target ? `${chosen.length} ${chosen.length === 1 ? "ação selecionada" : "ações selecionadas"}${problem ? " · Conferir conexão" : ""}` : "Escolha ou cadastre uma conexão"} onRemove={onRemove}>
    <label>Servidor MCP<select aria-label="Servidor MCP" value={creating ? "new" : target} onChange={(e) => choose(e.target.value)}>
      <option value="">Escolha um servidor</option>
      {servers.map((s) => <option key={s.prefixo} value={s.prefixo} disabled={used.includes(s.prefixo) && s.prefixo !== target}>{s.nome}{used.includes(s.prefixo) && s.prefixo !== target ? " · já adicionado" : ""}</option>)}
      {target && !server && <option value={target}>Conexão indisponível</option>}
      <option value="new">Cadastrar novo servidor…</option>
    </select></label>
    {creating && <ServerSettings onSaved={saved} onCancel={() => setCreating(false)} />}
    {server && <>
      {editing ? <ServerSettings key={server.prefixo} server={server} onSaved={saved} onCancel={() => setEditing(false)} onDeleted={() => { onServerDeleted(server.prefixo); onRemove(); }} /> : <div className="tool-server-connection">
        <small>{server.url}</small>
        <div className="studio-actions">
          <button type="button" className="studio-button" onClick={() => setEditing(true)}>Editar conexão</button>
          <a className="studio-button" href={`/api/conexoes/mcp/${server.prefixo}`} target="_blank" rel="noreferrer">{server.autorizado ? "Reautorizar" : "Autorizar"}</a>
        </div>
      </div>}
    </>}
    {target && <div className="mcp-actions">
      <div className="tool-section-heading"><h4>Ações deste servidor</h4><button type="button" className="tool-text-button" disabled={busy} onClick={() => void refresh()}>{busy ? "Consultando…" : "Atualizar ações"}</button></div>
      <p>Marque o que este agente pode fazer. Nenhuma ação é autorizada automaticamente.</p>
      {busy && <p role="status">Consultando ações do servidor…</p>}
      {problem && <p className="studio-error" role="alert">{problem} Confira a conexão e atualize as ações.</p>}
      {!!actions?.tools.length && <>
        <label>Buscar ações<input type="search" placeholder="Buscar por nome ou descrição…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="studio-actions">
          <button type="button" className="tool-text-button" disabled={busy} onClick={() => onSelection([...new Set([...chosen, ...actions.tools.map((t) => t.id)])])}>Selecionar todas</button>
          <button type="button" className="tool-text-button" disabled={!chosen.length} onClick={() => onSelection([])}>Desmarcar todas</button>
        </div>
        <div className="mcp-action-list">{actions.tools.filter((t) => `${t.name} ${t.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((t) => <label className="mcp-action" key={t.id}>
          <input type="checkbox" checked={chosen.includes(t.id)} onChange={(e) => onSelection(e.target.checked ? [...chosen, t.id] : chosen.filter((id) => id !== t.id))} />
          <span><strong>{t.label || t.name}</strong><small>{t.description}</small></span>
        </label>)}</div>
        {!actions.tools.some((t) => `${t.name} ${t.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p>Nenhuma ação encontrada para essa busca.</p>}
      </>}
      {!busy && actions && !actions.error && !actions.tools.length && <p>Este servidor não disponibilizou ações. Confira a conta e as permissões e atualize a lista.</p>}
      {!busy && unavailable.length > 0 && <div className="tool-unavailable"><p>Seleções salvas que não puderam ser verificadas. Elas foram preservadas:</p>{unavailable.map((id) => <label className="mcp-action" key={id}><input type="checkbox" checked onChange={() => onSelection(chosen.filter((t) => t !== id))} /><span>{id.split(":").slice(2).join(":")} · indisponível</span></label>)}</div>}
    </div>}
  </ToolCard>;
}
