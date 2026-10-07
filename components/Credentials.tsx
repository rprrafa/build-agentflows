"use client";
import { useState } from "react";
import { ChatGPTConnection, useChatGPT } from "./ChatGPTConnection";
import { StudioShell } from "./StudioUI";
import { ChatGPTUsage } from "./ChatGPTUsage";
import { ToolCredentialsManager } from "./ToolCredentialsManager";
export function Credentials() {
  const { connection, setConnection } = useChatGPT();
  const [connect, setConnect] = useState(false);
  return (
    <StudioShell
      active="credentials"
    >
      <main className="library-page connections-page">
        <header className="library-header">
          <div>
            <div className="studio-breadcrumb">Workspace / Credenciais</div>
            <h1>Credenciais</h1>
            <p>
              Gerencie as contas usadas pelos modelos de IA, ferramentas e embeddings.
            </p>
          </div>
        </header>
        <section className="credential-manager-card credential-chatgpt">
          <div className="credential-manager-row">
            <div className="credential-manager-identity">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="tool-logo" src="/knowledge-icons/embeddings-openai.svg" alt="" width={24} height={24} />
              <div><strong>ChatGPT · assinatura</strong><small>{connection?.account ? `${connection.account.email || "Conta conectada"}${connection.account.planType ? ` · ${connection.account.planType}` : ""}` : "Conecte sua conta para usar os modelos da assinatura."}</small></div>
            </div>
            <button type="button" className="studio-button" onClick={() => setConnect(true)}>{connection?.account ? "Gerenciar conexão" : "Conectar ChatGPT"}</button>
          </div>
          {connection?.account && <ChatGPTUsage />}
        </section>
        <ToolCredentialsManager />
      </main>
      {connect && (
        <ChatGPTConnection
          onClose={() => setConnect(false)}
          onChange={setConnection}
        />
      )}
    </StudioShell>
  );
}
