"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AccountUsage } from "@/lib/saas-plan";
import { REGRA_SENHA } from "@/lib/conta-comum";
import { Icon, StudioShell, request } from "./StudioUI";

type Account = { name: string; email: string; hasPassword: boolean; google: boolean; usage: AccountUsage };

const monthLabel = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

function UsageMeter({ label, used, limit, note }: { label: string; used: number; limit: number | null; note: string }) {
  const left = limit === null ? null : Math.max(0, limit - used);
  return (
    <div className={"account-usage" + (left === 0 ? " exhausted" : "")}>
      <div><strong>{label}</strong><span>{limit === null ? `${used.toLocaleString("pt-BR")} · ilimitado` : `${used.toLocaleString("pt-BR")} de ${limit.toLocaleString("pt-BR")}`}</span></div>
      {limit !== null && <progress aria-label={`${label}: ${used} de ${limit}`} value={Math.min(used, limit)} max={limit} />}
      <small>{limit === null ? "Sem limite no seu plano." : left === 0 ? "Limite atingido." : note}</small>
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState(""), [password, setPassword] = useState(""), [confirmPassword, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setMessage("");
    if (password !== confirmPassword) { setError("As senhas não são iguais."); return; }
    setBusy(true);
    try {
      await request("/api/conta/senha", "POST", { current, password, confirmPassword });
      setCurrent(""); setPassword(""); setConfirm("");
      setMessage("Senha alterada. As outras sessões desta conta foram encerradas.");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível alterar a senha."); }
    finally { setBusy(false); }
  }
  return (
    <form className="account-password" onSubmit={submit}>
      <label className="account-field">Senha atual<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required maxLength={256} autoComplete="current-password" /></label>
      <label className="account-field">Nova senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256} autoComplete="new-password" aria-describedby="password-rule" /></label>
      <label className="account-field">Confirmar nova senha<input type="password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} required maxLength={256} autoComplete="new-password" /></label>
      <small id="password-rule">{REGRA_SENHA}</small>
      {error && <p role="alert" className="account-error">{error}</p>}
      {message && <p role="status" className="account-success">{message}</p>}
      <div><button type="submit" className="studio-button primary" disabled={busy}>{busy ? "Alterando…" : "Alterar senha"}</button></div>
    </form>
  );
}

export function MyAccount() {
  const [account, setAccount] = useState<Account | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setAccount(await request<Account>("/api/conta")); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar sua conta."); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const usage = account?.usage, beta = usage?.plan === "beta";
  return (
    <StudioShell active="account">
      <main className="library-page account-page">
        <header className="library-header">
          <div>
            <div className="studio-breadcrumb">Workspace / Minha conta</div>
            <h1>Minha conta</h1>
            <p>Seus dados de acesso e o uso do plano.</p>
          </div>
        </header>
        {error && <p role="alert" className="account-error">{error} <button type="button" className="studio-button subtle" onClick={() => void load()}>Tentar novamente</button></p>}
        {!account && !error && <p className="settings-loading" role="status">Carregando…</p>}
        {account && usage && <>
          <section className="credential-manager-card account-card" aria-labelledby="account-profile">
            <h2 id="account-profile">Perfil</h2>
            <dl className="account-profile">
              <div><dt>Nome</dt><dd>{account.name}</dd></div>
              <div><dt>E-mail</dt><dd>{account.email}</dd></div>
              <div><dt>Acesso</dt><dd>{[account.hasPassword && "E-mail e senha", account.google && "Google"].filter(Boolean).join(" · ")}</dd></div>
            </dl>
          </section>
          <section className="credential-manager-card account-card" aria-labelledby="account-usage">
            <div className="account-card-title">
              <h2 id="account-usage">Limites de uso</h2>
              <span className={"account-plan" + (beta ? "" : " unlimited")}>{beta ? "Beta" : "AI Action"}</span>
            </div>
            <UsageMeter label={`Execuções em ${monthLabel(usage.month)}`} used={usage.runs.used} limit={usage.runs.limit} note="Renova no primeiro dia de cada mês." />
            <UsageMeter label="Fluxos" used={usage.flows.used} limit={usage.flows.limit} note="Excluir um fluxo libera espaço para outro." />
            {beta && (
              <div className="library-connect-banner account-upgrade">
                <Icon name="spark" size={23} />
                <div>
                  <strong>Faça parte do AI Action</strong>
                  <p>Tenha execuções mensais e fluxos ilimitados.</p>
                </div>
                <a className="studio-button primary" href={usage.upgradeUrl} target="_blank" rel="noopener noreferrer">Faça parte do AI Action</a>
              </div>
            )}
          </section>
          {account.hasPassword && (
            <section className="credential-manager-card account-card" aria-labelledby="account-password">
              <h2 id="account-password">Alterar senha</h2>
              <PasswordForm />
            </section>
          )}
        </>}
      </main>
    </StudioShell>
  );
}
