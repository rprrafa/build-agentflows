"use client";
import { useState } from "react";
import { TOOL_CREDENTIALS, TOOL_CREDENTIAL_LABELS } from "@/lib/tool-credentials";
import type { SavedToolCredential } from "@/lib/tool-credential-store";
import { CREDENTIAL_CATALOG } from "@/lib/tool-presentation";
import { ToolLogo, ToolSelect } from "./ToolSelect";
import { Icon, Modal, request } from "./StudioUI";

export function ToolCredentialDialog({ provider: initialProvider = "", credential, onSaved, onClose }: {
  provider?: string; credential?: SavedToolCredential; onSaved: (credential: SavedToolCredential) => void; onClose: () => void;
}) {
  const [provider, setProvider] = useState(credential?.provider || initialProvider);
  const [tool, setTool] = useState(CREDENTIAL_CATALOG.find((item) => item.provider === (credential?.provider || initialProvider))?.id || "");
  const [name, setName] = useState(credential?.name || "");
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const fields = credential?.fields || TOOL_CREDENTIALS[provider] || [];
  const value = (key: string) => draft[key] ?? (fields.find((field) => field.chave === key)?.valor || fields.find((field) => field.chave === key)?.defaultValue || "");
  async function save() {
    setBusy(true); setError("");
    try {
      const saved = await request<SavedToolCredential>(credential ? `/api/tool-credentials/${encodeURIComponent(credential.id)}` : "/api/tool-credentials", credential ? "PUT" : "POST", { name, provider, fields: draft });
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a conexão."); }
    finally { setBusy(false); }
  }
  function renderFields(optional: boolean) {
    return fields.filter((field) => !!field.optional === optional).map((field) => <div className="credential-input-row" key={field.chave}>
      <input aria-label={field.rotulo} type={field.secret ? "password" : "text"} autoComplete="off" disabled={busy || credential?.locked}
        value={draft[field.chave] === null ? "" : value(field.chave)} placeholder={field.definido && field.secret ? `${field.rotulo} · já salva` : field.rotulo}
        onChange={(event) => setDraft((d) => ({ ...d, [field.chave]: event.target.value }))} />
      {field.optional && field.definido && <button type="button" className="studio-icon-button" title={draft[field.chave] === null ? "Manter valor salvo" : "Remover valor salvo"} aria-label={draft[field.chave] === null ? "Manter valor salvo" : "Remover valor salvo"} disabled={busy || credential?.locked} onClick={() => setDraft((d) => {
        const next = { ...d };
        if (d[field.chave] === null) delete next[field.chave]; else next[field.chave] = null;
        return next;
      })}><Icon name={draft[field.chave] === null ? "undo" : "trash"} size={16} /></button>}
    </div>);
  }
  return <Modal title={provider ? <h2 className="credential-title"><ToolLogo id={tool || `interno:${provider}`} />{TOOL_CREDENTIAL_LABELS[provider] || provider}</h2> : "Nova credencial"} onClose={() => { if (!busy) onClose(); }} className="credential-dialog">
    <div className="node-fields">
      {!credential && !initialProvider ? <ToolSelect label="Serviço" value={tool} catalog={CREDENTIAL_CATALOG} disabled={busy} onChange={(id) => { setTool(id); setProvider(CREDENTIAL_CATALOG.find((item) => item.id === id)!.provider); setDraft({}); setError(""); }} /> : null}
      {!!provider && <>
        <input aria-label="Nome da credencial" value={name} maxLength={100} placeholder="Nome da credencial" disabled={busy || credential?.legacy} onChange={(event) => setName(event.target.value)} />
        {fields.find((field) => field.link)?.link && <a className="credential-help" href={fields.find((field) => field.link)!.link} target="_blank" rel="noreferrer">Obter credencial {TOOL_CREDENTIAL_LABELS[provider]}</a>}
        {renderFields(false)}
        {fields.some((f) => f.optional) && <details className="credential-advanced"><summary>Opções avançadas</summary><div className="node-fields">{renderFields(true)}</div></details>}
      </>}
      {credential?.locked && <p>Esta conexão foi definida no servidor. Crie uma nova credencial para usar outra conta.</p>}
    </div>
    {error && <p className="studio-error" role="alert">{error}</p>}
    <div className="modal-actions">
      <button type="button" className="studio-button primary" disabled={busy || !provider || !name.trim() || credential?.locked} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar credencial"}</button>
    </div>
  </Modal>;
}
