"use client";
import { useEffect, useRef, useState } from "react";
import type { ToolInfo } from "@/lib/tools";
import type { ToolCard } from "@/lib/agent-tools";
import type { SavedToolCredential } from "@/lib/tool-credential-store";
import { ToolCredentialFields } from "./ToolCredentialFields";
import { request } from "./StudioUI";
export const ACTION_TOOLS = ["brave_mcp", "browserless", "postgres_mcp", "github_mcp", "custom_mcp", "composio", "openapi"];
type Option = { id: string; name: string; description?: string };
export function ToolParameters({ tool, card, credentials, onChange, onSaved }: {
  tool: ToolInfo; card: ToolCard; credentials: SavedToolCredential[]; onChange: (patch: Partial<ToolCard>) => void; onSaved: (credential: SavedToolCredential) => void;
}) {
  const params = card.params || {};
  const [flows, setFlows] = useState<Option[]>([]), [apps, setApps] = useState<Option[]>([]), [accounts, setAccounts] = useState<Option[]>([]), [actions, setActions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [query, setQuery] = useState("");
  const generation = useRef(0);
  const connection = card.credentialId || credentials.find((c) => c.provider === tool.credentialProvider && c.legacy)?.id;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tool.name === "executar_fluxo") request<(Option & { published?: unknown })[]>("/api/flows").then((all) => setFlows(all.filter((flow) => !!flow.published))).catch(() => setError("Não foi possível carregar os fluxos."));
    }, 0);
    const invalidate = () => { generation.current++; };
    return () => { clearTimeout(timer); invalidate(); };
  }, [tool.name, connection, params.app]);
  function change(key: string, value: string) { onChange({ params: { ...params, [key]: value } }); }
  async function load(kind: "apps" | "accounts" | "actions") {
    const current = ++generation.current;
    setBusy(true); setError("");
    try {
      const result = await request<Option[]>("/api/tools/options", "POST", { tool: tool.id, credentialId: connection, params, kind });
      if (current === generation.current) { if (kind === "apps") setApps(result); else if (kind === "accounts") setAccounts(result); else setActions(result); }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Não foi possível carregar as opções."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  let selected: string[] = [];
  try { selected = JSON.parse(params.actions || "[]"); } catch {}
  const accountChanged = (id: string) => { generation.current++; setBusy(false); setApps([]); setAccounts([]); setActions([]); onChange({ credentialId: id, params: { ...params, ...(ACTION_TOOLS.includes(tool.name) ? { actions: "[]", connectedAccountId: "" } : {}) } }); };
  return <div className="tool-parameters-fields">
    <ToolCredentialFields tool={tool} credentialId={card.credentialId} credentials={credentials} onChange={accountChanged} onSaved={onSaved} />
    {tool.name === "executar_fluxo" && <>
      <label>Fluxo Agêntico<select value={params.flowId || ""} onChange={(event) => change("flowId", event.target.value)}><option value="">Selecione um fluxo publicado</option>{flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}{params.flowId && !flows.some((flow) => flow.id === params.flowId) && <option value={params.flowId}>Fluxo indisponível</option>}</select></label>
      <label>Descrição<textarea rows={2} placeholder="Quando o agente deve usar este fluxo?" value={params.description || ""} onChange={(event) => change("description", event.target.value)} /></label>
    </>}
    {tool.name === "data_hora" && <label>Fuso horário<select value={params.timezone || "America/Sao_Paulo"} onChange={(event) => change("timezone", event.target.value)}>{["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Rio_Branco", "America/Noronha", "Europe/Lisbon", "UTC"].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>}
    {tool.name === "composio" && <>
      <label>Aplicativo<select value={params.app || ""} onChange={(event) => { generation.current++; setBusy(false); setAccounts([]); setActions([]); onChange({ params: { ...params, app: event.target.value, connectedAccountId: "", actions: "[]" } }); }}><option value="">Selecione um aplicativo</option>{apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}{params.app && !apps.some((app) => app.id === params.app) && <option value={params.app}>{params.app}</option>}</select></label>
      <button className="tool-text-button" type="button" disabled={busy || !connection} onClick={() => void load("apps")}>Carregar aplicativos</button>
      {params.app && <><label>Conta conectada<select value={params.connectedAccountId || ""} onChange={(event) => change("connectedAccountId", event.target.value)}><option value="">Selecione uma conta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}{params.connectedAccountId && !accounts.some((a) => a.id === params.connectedAccountId) && <option value={params.connectedAccountId}>{params.connectedAccountId}</option>}</select></label><button className="tool-text-button" type="button" disabled={busy || !connection} onClick={() => void load("accounts")}>Carregar contas</button></>}
    </>}
    {ACTION_TOOLS.includes(tool.name) && <div className="tool-allowed-actions">
      <div className="tool-section-heading"><span>Ações disponíveis</span><button type="button" className="tool-text-button" disabled={busy || !connection || (tool.name === "composio" && !params.app)} onClick={() => void load("actions")}>{busy ? "Carregando…" : "Atualizar"}</button></div>
      {!!actions.length && <input type="search" aria-label="Buscar ações" placeholder="Buscar ação…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div className="tool-allowed-list">{[...actions, ...selected.filter((id) => !actions.some((action) => action.id === id)).map((id) => ({ id, name: id }))].filter((action) => action.name.toLowerCase().includes(query.toLowerCase())).map((action) => <label key={action.id}><input type="checkbox" checked={selected.includes(action.id)} onChange={(event) => change("actions", JSON.stringify(event.target.checked ? [...selected, action.id] : selected.filter((id) => id !== action.id)))} /><span>{action.name}</span></label>)}</div>
      {!actions.length && !selected.length && <small>Atualize a lista para selecionar as ações.</small>}
      {params.actions === undefined && <small>Este fluxo anterior usa todas as ações. Marque as que deseja manter.</small>}
    </div>}
    {!tool.credentialProvider && !["executar_fluxo", "data_hora"].includes(tool.name) && <small>Não há parâmetros adicionais.</small>}
    {error && <p className="studio-error" role="alert">{error}</p>}
  </div>;
}
