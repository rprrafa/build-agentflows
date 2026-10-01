"use client";
import { useEffect, useRef, useState } from "react";
import type { SavedToolCredential } from "@/lib/tool-credential-store";
import { request } from "./StudioUI";
export function OpenRouterConnect({ onSaved }: { onSaved: (credential: SavedToolCredential) => void }) {
  const popup = useRef<Window | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "openrouter-connected") return;
      setBusy(false);
      if (event.data.error) { setError(String(event.data.error)); return; }
      if (typeof event.data.credentialId !== "string") return;
      void request<SavedToolCredential>(`/api/tool-credentials/${encodeURIComponent(event.data.credentialId)}`).then(credential => { window.dispatchEvent(new Event("credentials-changed")); onSaved(credential); }).catch(e => setError(e.message));
    }
    window.addEventListener("message", receive);
    const timer = setInterval(() => { if (popup.current?.closed) { setBusy(false); popup.current = null; } }, 1000);
    return () => { window.removeEventListener("message", receive); clearInterval(timer); };
  }, [onSaved]);
  return <div>
    <button type="button" className="studio-button" disabled={busy} onClick={() => {
      setError("");
      popup.current = window.open("/api/conexoes/openrouter?popup=1", "openrouter-auth", "popup,width=680,height=760");
      if (!popup.current) setError("Permita a abertura da janela para conectar o OpenRouter.");
      else setBusy(true);
    }}>{busy ? "Aguardando autorização…" : "Conectar com OpenRouter (OAuth)"}</button>
    {error && <p className="studio-error" role="alert">{error}</p>}
  </div>;
}
