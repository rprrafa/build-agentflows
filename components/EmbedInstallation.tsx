"use client";
import { useState } from "react";
import { embedInstallation } from "@/lib/embed-installation";
import { IconButton } from "./StudioUI";
import { FeedbackToast } from "./FeedbackToast";
export function EmbedInstallation({ origin, flowId, onCopy }: { origin: string; flowId: string; onCopy?: () => void }) {
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const snippet = embedInstallation(origin, flowId);
  async function copy() {
    setError(""); setNotice(""); onCopy?.();
    try { await navigator.clipboard.writeText(snippet); setNotice("Script de instalação copiado."); }
    catch { setError("Não foi possível copiar. Selecione o script abaixo e copie manualmente."); }
  }
  return <div className="embed-installation">
    <div className="embed-installation-heading"><strong>Script de instalação</strong><IconButton icon={notice ? "check" : "copy"} label="Copiar instalação" disabled={!origin} onClick={() => void copy()}/></div>
    <pre className="integration-code">{snippet}</pre>
    <small>Cole no HTML da sua página. O endereço <code>/api/chat-access</code> deve fornecer o acesso temporário pelo seu servidor. <a href="/embed-integration.md" target="_blank" rel="noreferrer">Ver guia de instalação ↗</a></small>
    {error && <p className="studio-error" role="alert">{error}</p>}
    <FeedbackToast message={notice} onDismiss={() => setNotice("")}/>
  </div>;
}
