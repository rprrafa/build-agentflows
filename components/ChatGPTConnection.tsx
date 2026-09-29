"use client";
import { useEffect, useState } from "react";
import { Icon, Modal, request } from "./StudioUI";
export type ConnectionState = {
  account: { email?: string; planType?: string } | null;
  login: { loginId: string; verificationUrl: string; userCode: string } | null;
  error: string | null;
  models: import("@/lib/model-capabilities").ModelCapability[];
};
export function useChatGPT() {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  useEffect(() => {
    let alive = true;
    void request<ConnectionState>("/api/chatgpt")
      .then((c) => {
        if (alive) setConnection(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { connection, setConnection };
}
export function ChatGPTConnection({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: (c: ConnectionState) => void;
}) {
  const [connection, setConnection] = useState<ConnectionState | null>(null),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      request<ConnectionState>("/api/chatgpt")
        .then((c) => {
          if (alive) {
            setConnection(c);
            onChange(c);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [onChange]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível conectar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Sua conta ChatGPT" onClose={onClose}>
      <div className="connect-intro">
        <div className="chatgpt-symbol">
          <Icon name="spark" size={32} />
        </div>
        <h3>
          {connection?.account
            ? "Pronto para criar com ChatGPT"
            : "Seus agentes, com sua assinatura"}
        </h3>
        <p>
          Entre com sua conta ChatGPT pelo login oficial do Codex. O uso segue
          os limites e o acesso do seu plano.
        </p>
      </div>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      {connection?.error && (
        <p className="studio-error" role="alert">
          {connection.error}
        </p>
      )}
      {connection?.account ? (
        <>
          <div className="connected-card">
            <Icon name="check" />
            <div>
              <strong>{connection.account.email || "Conta conectada"}</strong>
              <p>
                {connection.account.planType || "ChatGPT"} · Sessão protegida
                neste servidor
              </p>
            </div>
          </div>
          <div className="modal-actions">
            <button
              className="studio-button danger"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await request("/api/chatgpt", "DELETE", {});
                  const c = await request<ConnectionState>("/api/chatgpt");
                  setConnection(c);
                  onChange(c);
                })
              }
            >
              Desconectar
            </button>
            <button className="studio-button primary" onClick={onClose}>
              Continuar
            </button>
          </div>
        </>
      ) : connection?.login ? (
        <div className="device-login">
          <p>Abra a página oficial e informe este código:</p>
          <button
            className={"device-code" + (copied ? " copied" : "")}
            title="Copiar código"
            onClick={() => {
              void navigator.clipboard.writeText(connection.login!.userCode);
              setCopied(true);
            }}
          >
            {connection.login.userCode}
            <Icon name={copied ? "check" : "copy"} size={18} />
            <small>{copied ? "Copiado" : "Copiar"}</small>
          </button>
          <a
            className="studio-button primary"
            target="_blank"
            rel="noreferrer"
            href={connection.login.verificationUrl}
          >
            Entrar no ChatGPT
          </a>
          <p className="login-wait">
            <span className="studio-spinner" /> Aguardando sua autorização…
          </p>
          <button
            className="studio-button subtle"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await request("/api/chatgpt", "DELETE", { cancel: true });
                setConnection((c) => (c ? { ...c, login: null } : c));
              })
            }
          >
            Cancelar conexão
          </button>
        </div>
      ) : (
        <>
          <button
            className="studio-button primary full"
            disabled={busy || !connection}
            onClick={() =>
              act(async () => {
                const login = await request<
                  NonNullable<ConnectionState["login"]>
                >("/api/chatgpt", "POST");
                setConnection((c) => (c ? { ...c, login } : c));
              })
            }
          >
            {busy ? "Preparando conexão…" : "Conectar com ChatGPT"}
          </button>
          <p className="connection-note">
            Se solicitado, habilite o login por código de dispositivo nas
            configurações de segurança do ChatGPT. Você autoriza sua conta
            diretamente na OpenAI.
          </p>
        </>
      )}
      <p className="connection-footnote">
        Sem chaves de acesso à IA. A conta conectada atende aos fluxos desta
        instalação.
      </p>
    </Modal>
  );
}
