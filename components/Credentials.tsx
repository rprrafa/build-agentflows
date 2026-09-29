"use client";
import { useState } from "react";
import { ChatGPTConnection, useChatGPT } from "./ChatGPTConnection";
import { StudioShell } from "./StudioUI";
import { ToolCredentialsManager } from "./ToolCredentialsManager";
export function Credentials() {
  const { connection, setConnection } = useChatGPT();
  const [connect, setConnect] = useState(false);
  return (
    <StudioShell
      active="credentials"
      connected={!!connection?.account}
      onConnect={() => setConnect(true)}
    >
      <main className="library-page connections-page">
        <header className="library-header">
          <div>
            <div className="studio-breadcrumb">Workspace / Credenciais</div>
            <h1>Credenciais</h1>
            <p>
              Gerencie as contas usadas pelas ferramentas e pelos modelos de
              embedding.
            </p>
          </div>
        </header>
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
