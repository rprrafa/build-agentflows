"use client";
import { useEffect, useState } from "react";
import type { PostgresConnection } from "@/lib/knowledge-types";
import type { SavedToolCredential } from "@/lib/tool-credential-store";
import { Icon, request } from "./StudioUI";
import { ToolCredentialDialog } from "./ToolCredentialDialog";

type ConnectionFields = { postgres?: PostgresConnection; connectionString?: string };
export function KnowledgePostgresFields({ value, configured, onChange }: {
  value: ConnectionFields; configured?: boolean; onChange: (value: ConnectionFields) => void;
}) {
  const [items, setItems] = useState<SavedToolCredential[]>([]);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(value.postgres || !configured ? "fields" : "url");
  useEffect(() => {
    let active = true;
    void request<SavedToolCredential[]>("/api/tool-credentials?provider=knowledge_postgres").then(data => { if (active) setItems(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const pg = value.postgres || { host: "", database: "", port: 5432, ssl: true, credentialId: "" };
  const selected = items.find(c => c.id === pg.credentialId);
  const change = (next: Partial<PostgresConnection>) => onChange({ postgres: { ...pg, ...next }, connectionString: "" });
  return <>
    <label>Conexão PostgreSQL
      <select value={mode} onChange={e => { setMode(e.target.value); onChange({ postgres: e.target.value === "fields" ? pg : undefined, connectionString: "" }); }}>
        <option value="fields">Host, banco e credencial</option>
        <option value="url">String de conexão</option>
      </select>
    </label>
    {mode === "url" ? <label>String de conexão PostgreSQL
      <input type="password" autoComplete="new-password" required={!configured} value={value.connectionString || ""} placeholder={configured ? "Conexão salva · preencha para substituir" : "postgresql://usuario:senha@servidor:5432/banco"} onChange={e => onChange({ postgres: undefined, connectionString: e.target.value })} />
      <small>A conexão é armazenada de forma cifrada.</small>
    </label> : <>
      <div className="credential-select-row">
        <label>Credencial PostgreSQL
          <select required value={pg.credentialId} onChange={e => { if (e.target.value === "new") setEditor("new"); else change({ credentialId: e.target.value }); }}>
            <option value="" disabled>Selecionar credencial</option>
            {items.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            {pg.credentialId && !selected && <option value={pg.credentialId}>Credencial indisponível</option>}
            <option value="new">+ Criar nova credencial</option>
          </select>
        </label>
        {selected && <button type="button" className="studio-icon-button" aria-label="Editar credencial PostgreSQL" onClick={() => setEditor("edit")}><Icon name="pencil" size={18} /></button>}
      </div>
      <div className="knowledge-form-grid">
        <label>Host<input required value={pg.host} placeholder="postgres.exemplo.com" onChange={e => change({ host: e.target.value })} /></label>
        <label>Banco de dados<input required value={pg.database} placeholder="agentflows" onChange={e => change({ database: e.target.value })} /></label>
        <label>Porta<input type="number" required min={1} max={65535} value={pg.port} onChange={e => change({ port: Number(e.target.value) })} /></label>
      </div>
      <label className="knowledge-checkbox"><input type="checkbox" checked={pg.ssl} onChange={e => change({ ssl: e.target.checked })} />Usar SSL com validação do certificado</label>
      <details><summary>Tempos limite da conexão</summary><div className="knowledge-form-grid">
        <label>Conectar em até (segundos)<input type="number" min={1} max={600} value={(pg.connectionTimeout ?? 10000) / 1000} onChange={e => change({ connectionTimeout: Number(e.target.value) * 1000 })} /></label>
        <label>Consulta em até (segundos)<input type="number" min={1} max={600} value={(pg.queryTimeout ?? 120000) / 1000} onChange={e => change({ queryTimeout: Number(e.target.value) * 1000 })} /></label>
      </div></details>
    </>}
    {error && <p className="studio-error" role="alert">{error}</p>}
    {editor && <ToolCredentialDialog provider="knowledge_postgres" credential={editor === "edit" ? selected : undefined} onClose={() => setEditor(null)} onSaved={c => { setItems(all => [...all.filter(item => item.id !== c.id), c]); change({ credentialId: c.id }); setEditor(null); }} />}
  </>;
}
