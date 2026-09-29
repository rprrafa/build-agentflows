"use client";
import { useState } from "react";
import type { ToolInfo } from "@/lib/tools";
import type { SavedToolCredential } from "@/lib/tool-credential-store";
import { Icon } from "./StudioUI";
import { ToolCredentialDialog } from "./ToolCredentialDialog";

export function ToolCredentialFields({ tool, credentialId, credentials, onChange, onSaved }: {
  tool: ToolInfo; credentialId?: string; credentials: SavedToolCredential[];
  onChange: (id: string) => void; onSaved: (credential: SavedToolCredential) => void;
}) {
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const available = credentials.filter((c) => c.provider === tool.credentialProvider);
  const id = credentialId || available.find((c) => c.legacy)?.id || "";
  const selected = available.find((c) => c.id === id);
  if (!tool.credentialProvider) return null;
  return <div className="tool-credential-fields">
    <div className="credential-select-row"><label>Credencial<select value={id} onChange={(event) => event.target.value === "new" ? setEditor("new") : onChange(event.target.value)}>
      <option value="" disabled>Escolha uma credencial</option>
      {available.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.configured ? " · revisar conexão" : ""}</option>)}
      {!!id && !selected && <option value={id}>Credencial indisponível</option>}
      <option value="new">+ Criar nova credencial</option>
    </select></label>
    {selected && <button type="button" className="studio-icon-button" title="Editar credencial" aria-label="Editar credencial" onClick={() => setEditor("edit")}><Icon name="pencil" size={18} /></button>}
    </div>
    {id && !selected && <p className="studio-error" role="alert">Esta credencial não está disponível. Escolha outra conexão.</p>}
    {editor && <ToolCredentialDialog provider={tool.credentialProvider} credential={editor === "edit" ? selected : undefined} onClose={() => setEditor(null)} onSaved={(c) => { onSaved(c); onChange(c.id); setEditor(null); }} />}
  </div>;
}
