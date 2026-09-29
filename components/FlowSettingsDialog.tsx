"use client";
import { useEffect, useState } from "react";
import type { Flow } from "@/lib/flow-types";
import { Icon, Modal, request } from "./StudioUI";
export type FlowSettings = Pick<Flow, "name" | "description" | "voiceId">;
export function FlowSettingsDialog({ flow, voiceAvailable, onClose, onSave }: {
  flow: Flow; voiceAvailable: boolean; onClose: () => void; onSave: (settings: FlowSettings) => Promise<void>;
}) {
  const [name, setName] = useState(flow.name), [description, setDescription] = useState(flow.description);
  const [voiceId, setVoiceId] = useState(flow.voiceId || "");
  const [voices, setVoices] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(voiceAvailable), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [voiceError, setVoiceError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!voiceAvailable) return;
    let alive = true;
    void request<{ id: string; nome: string }[]>("/api/voz/vozes").then((items) => { if (alive) setVoices(items); })
      .catch((e) => { if (alive) setVoiceError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [voiceAvailable, retry]);
  async function save() {
    setBusy(true); setError("");
    try { await onSave({ name: name.trim(), description, voiceId }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <Modal title="Configurações do fluxo" onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="node-fields">
        <label>Nome<input autoFocus value={name} maxLength={100} required disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
        <label>Descrição<textarea rows={3} value={description} maxLength={1000} disabled={busy} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="flow-voice-settings">
          <div><Icon name="wave" size={20} /><strong>Conversa por voz</strong></div>
          <p>A voz escolhida será usada nas respostas faladas deste fluxo.</p>
          <label>Voz do fluxo<select value={voiceId} disabled={busy || loading || !voiceAvailable} onChange={(e) => setVoiceId(e.target.value)}>
            <option value="">Padrão da instalação</option>
            {voiceId && !voices.some((v) => v.id === voiceId) && <option value={voiceId}>Voz salva · {voiceId}</option>}
            {voices.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select></label>
          {loading && <small role="status">Carregando vozes…</small>}
          {voiceError && <p role="alert">{voiceError} <button type="button" onClick={() => { setLoading(true); setVoiceError(""); setRetry((v) => v + 1); }}>Tentar novamente</button></p>}
          {!voiceAvailable && <p><a href="/configuracoes" target="_blank" rel="noreferrer">Conecte a ElevenLabs em Configurações</a> para habilitar a conversa por voz.</p>}
        </div>
      </div>
      {error && <p className="studio-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="studio-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="studio-button primary" disabled={busy || !name.trim()}>{busy ? "Salvando…" : "Salvar configurações"}</button></div>
    </form>
  </Modal>;
}
