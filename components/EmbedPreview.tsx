"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { EmbedInstallation } from "./EmbedInstallation";
import { Icon } from "./StudioUI";
type Widget = { destroy: () => void; open: () => void };
export function EmbedPreview({ flowId, flowName }: { flowId: string; flowName: string }) {
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [origin, setOrigin] = useState("");
  const widget = useRef<Widget | null>(null);
  useEffect(() => {
    if (!ready) return;
    const runtime = (window as unknown as {Agentflows:{mount:(options:unknown)=>Widget}}).Agentflows;
    const timer = setTimeout(() => {
      setOrigin(location.origin);
      try {
        widget.current = runtime.mount({ url: location.origin, flowId, appVersion: "preview-1", getToken: async () => {
          const res = await fetch(`/api/flows/${flowId}/embed`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"preview"}) });
          const data = await res.json();
          if (!res.ok) { setError(data.error); throw new Error(data.error); }
          setError("");
          return data;
        } });
      } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível abrir o chat."); }
    }, 0);
    return () => { clearTimeout(timer); widget.current?.destroy(); widget.current = null; };
  }, [flowId,ready]);
  return <main className="embed-preview-page">
    <Script src="/embed.js" strategy="afterInteractive" onReady={() => setReady(true)}/>
    <a className="embed-preview-back" href={`/flows/${flowId}`}><Icon name="arrow" size={17}/>Voltar ao fluxo</a>
    <section className="embed-preview-empty">
      <div className="empty-flow-art" aria-hidden="true">
        <span><Icon name="start" size={23}/></span><i/>
        <span><Icon name="agent" size={30}/></span><i/>
        <span><Icon name="end" size={23}/></span>
      </div>
      <p>Este é um link de preview do seu fluxo</p>
      <h1>{flowName}</h1>
      <p className="embed-preview-hint">Abra o chat no canto da tela para testar a conversa.</p>
      <details className="embed-preview-installation">
        <summary>Instalar este chat no meu site</summary>
        <EmbedInstallation origin={origin} flowId={flowId}/>
      </details>
      {error && <p className="studio-error" role="alert">{error} Confira as configurações de Chat no Site e inclua este endereço nos domínios permitidos.</p>}
    </section>
  </main>;
}
