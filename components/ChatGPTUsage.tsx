"use client";
import { useCallback, useEffect, useState } from "react";
import type { ChatGPTUsage as Usage, UsageWindow } from "@/lib/account-usage";
import { request } from "./StudioUI";
function windowLabel(w: UsageWindow, fallback: string) {
  const m = w.windowDurationMins;
  return !m ? fallback : m % 1440 === 0 ? `${m / 1440} dias` : m % 60 === 0 ? `${m / 60} horas` : `${m} minutos`;
}
export function ChatGPTUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setUsage(await request<Usage>("/api/chatgpt/usage")); setError(""); }
    catch { setError("Não foi possível consultar os limites agora. Tente atualizar."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);
  return <div className="chatgpt-usage" aria-label="Limites da assinatura">
    <div className="usage-title"><strong>Limites da assinatura</strong><button className="studio-button subtle" disabled={busy} onClick={() => void refresh()}>{busy ? "Consultando…" : "Atualizar"}</button></div>
    <small>Uso da conta pelo Codex, compartilhado com outras sessões.</small>
    {error && <p role="status">{error}{usage && " Os valores abaixo são da última consulta."}</p>}
    {usage?.buckets.map((b, index) => <div key={b.limitId || index}>
      <strong>{b.limitName || b.limitId || "Conta conectada"}</strong>
      {([b.primary, b.secondary] as const).map((w, i) => w && <div className="usage-window" key={i}>
        <div><span>{windowLabel(w, i ? "Limite adicional" : "Limite principal")}</span><span>{Math.round(100 - w.usedPercent)}% disponível</span></div>
        <progress aria-label={`Disponível em ${windowLabel(w, "janela atual")}`} value={100 - w.usedPercent} max={100} />
        {w.resetsAt && <small>Renova em {new Date(w.resetsAt * 1000).toLocaleString("pt-BR")}</small>}
      </div>)}
    </div>)}
    {usage && !usage.buckets.some((b) => b.primary || b.secondary) && <p>A conta não informou limites nesta consulta.</p>}
    {usage && <small>Atualizado em {new Date(usage.updatedAt).toLocaleTimeString("pt-BR")}</small>}
  </div>;
}
