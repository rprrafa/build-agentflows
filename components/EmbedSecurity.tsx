"use client";
import { useEffect, useState } from "react";
import { AllowedOrigins } from "./AllowedOrigins";
import { Icon, request } from "./StudioUI";
export function EmbedSecurity() {
  const [origins, setOrigins] = useState<string[]>([]), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => { let alive = true; void request<{ origins: string[] }>("/api/security/embed").then((s) => { if (alive) { setOrigins(s.origins); setReady(true); } }).catch((e) => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  async function save() {
    setBusy(true); setMessage(""); setError("");
    try { const saved = await request<{ origins: string[] }>("/api/security/embed", "PUT", { origins: origins.map((v) => v.trim()) }); setOrigins(saved.origins); setMessage("Sites autorizados salvos."); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <section>
    <div className="settings-section-heading"><Icon name="shield" size={18} /><div><h2>Segurança</h2><p>Controle os domínios que podem acessar o chat dos seus fluxos.</p></div></div>
    <div className="connection-card security-settings">
      <AllowedOrigins origins={origins} onChange={setOrigins} disabled={!ready || busy}
        description="Defina os sites autorizados nesta instalação. Esta lista limita os domínios configurados em cada fluxo."
        emptyText="Nenhuma restrição global definida. Valem as permissões de cada fluxo." />
      <div className="security-settings-actions">
        {message && <p role="status">{message}</p>}{error && <p className="studio-error" role="alert">{error}</p>}
        <button className="studio-button primary" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar domínios"}</button>
      </div>
    </div>
  </section>;
}
