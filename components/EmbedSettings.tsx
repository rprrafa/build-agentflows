"use client";
import { useEffect, useState } from "react";
import type { EmbedSettings as Settings } from "@/lib/embed-protocol";
import { AllowedOrigins } from "./AllowedOrigins";
import { EmbedInstallation } from "./EmbedInstallation";
import { FeedbackToast } from "./FeedbackToast";
import { request } from "./StudioUI";
export function EmbedSettings({ flowId, published, origin }: { flowId: string; published: boolean; origin: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; request<{ settings: Settings }>(`/api/flows/${flowId}/embed`).then(r => { if (alive) { setSettings(r.settings); setSites(r.settings.origins); } }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [flowId]);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); } finally { setBusy(false); } }
  async function salvarConfiguracao() {
    if (!settings) throw new Error("As configurações ainda estão carregando.");
    const result = await request<Settings>(`/api/flows/${flowId}/embed`, "PUT", {...settings, enabled:true, origins:sites.map(s => s.trim())});
    setSettings(result); setSites(result.origins);
  }
  async function testarPagina() {
    const preview = window.open("about:blank", "_blank");
    if (!preview) { setError("Permita a abertura de uma nova aba para salvar e testar a prévia."); return; }
    preview.opener = null;
    await act(async () => {
      try {
        await salvarConfiguracao();
        preview.location.replace(`/embed-preview/${flowId}`);
        setNotice("Configurações salvas. Abrindo o teste...");
      } catch (e) {
        preview.close();
        throw e;
      }
    });
  }

  return <section className="integration-section embed-settings">
    <h3>Uma conversa dentro do seu site</h3><p>As pessoas podem pedir melhorias e acompanhar as respostas finais sem sair da aplicação. A conversa continua quando a página é recarregada.</p>
    {error && <p className="studio-error" role="alert">{error}</p>}{notice && <FeedbackToast message={notice} onDismiss={() => setNotice("")}/>}
    {!published && <p className="generator-warning">Salve o fluxo no editor antes de ativar o chat no site.</p>}
    {settings && <><div className="node-fields">
      <label>Nome do agente<input required value={settings.agentName || ""} maxLength={80} onChange={e => setSettings({...settings,agentName:e.target.value})}/></label>
      <label>Link do avatar (opcional)<input type="url" value={settings.avatarUrl || ""} maxLength={2048} placeholder="https://..." onChange={e => setSettings({...settings,avatarUrl:e.target.value})}/><small>Use o endereço HTTPS direto da imagem.</small></label>
      <label>Título do chat<input value={settings.title} maxLength={80} onChange={e => setSettings({...settings,title:e.target.value})}/></label>
      <label>Mensagem de boas-vindas<textarea value={settings.welcome} maxLength={500} onChange={e => setSettings({...settings,welcome:e.target.value})}/></label>
      <p className="text-muted text-[13px]">O chat mostra as mensagens e respostas finais. Atividades internas do fluxo ficam ocultas.</p>
      <AllowedOrigins origins={sites} onChange={setSites} disabled={busy}
        description="Escolha em quais sites este chat pode ser aberto. As permissões globais de Segurança também se aplicam."
        emptyText="Nenhum domínio adicionado. Localhost e 127.0.0.1 são aceitos por padrão, em qualquer porta." />

    </div><div className="studio-actions"><button className="studio-button primary" disabled={busy || !published || !settings.agentName?.trim()} onClick={() => void act(async () => { await salvarConfiguracao(); setNotice("Configurações do chat salvas."); })}>Salvar chat</button><button className="studio-button" type="button" disabled={busy || !published || !settings.agentName?.trim()} onClick={() => void testarPagina()} title="Salva as configurações atuais antes de abrir a prévia">Salvar e testar em uma página</button></div>
    <details className="integration-section"><summary style={{cursor:"pointer",fontWeight:600}}>Instalação e opções para desenvolvedores</summary><p>Instale o script uma vez no layout principal. O servidor da aplicação identifica o usuário e fornece um acesso temporário ao chat.</p>
      <EmbedInstallation origin={origin} flowId={flowId} onCopy={() => setNotice("")}/>
      <h4>Limites por tarefa</h4><div className="node-fields"><label>Tempo de trabalho (minutos)<input type="number" min={1} max={60} value={settings.maxMinutes} onChange={e => setSettings({...settings,maxMinutes:Number(e.target.value)})}/></label><label>Ações na página<input type="number" min={1} max={30} value={settings.maxCommands} onChange={e => setSettings({...settings,maxCommands:Number(e.target.value)})}/></label></div><small>Salve o chat para aplicar. Esperas em blocos de aprovação não consomem tempo de trabalho. Retomadas após interrupção são limitadas a duas por tarefa.</small>
    </details></>}
    {settings && <details className="integration-section"><summary style={{cursor:"pointer",fontWeight:600}}>Opções avançadas: eventos entre página e agente</summary>
      <h4>Página → agente</h4><p>Envie contexto ou erros da página. O agente considera o evento na próxima análise; o envio não inicia uma tarefa nem interrompe uma resposta em andamento.</p>
      <pre className="integration-code">{`chat.emit("page.contextChanged", { screen: "pedidos", filter: "abertos" });
chat.emit("page.errorReported", {
  message: "Não foi possível carregar os pedidos",
  code: "ORDERS_LOAD_FAILED"
});`}</pre>
      <h4>Agente → página</h4><p>Registre uma ação no script de instalação. Ela aparece ao agente como ferramenta e a pessoa confirma antes da execução.</p>
      <pre className="integration-code">{`actions: {
  "app.openOrder": {
    description: "Abrir um pedido pelo identificador",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"], additionalProperties: false
    },
    handle: async ({ id }, { signal }) => {
      await abrirPedido(id, { signal });
      return { opened: true };
    }
  }
}`}</pre>
      <p>Valide os argumentos e as permissões dentro de cada handler, respeite <code>signal.aborted</code> e retorne apenas dados JSON. Não envie senhas, tokens ou valores privados de formulários nos eventos.</p>
      <a href="/embed-integration.md" target="_blank" rel="noreferrer">Ver guia completo de eventos e ações ↗</a>
    </details>}
  </section>;
}
