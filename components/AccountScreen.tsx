"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { REGRA_SENHA } from "@/lib/conta-comum";

type Mode = "login" | "register" | "forgot-password" | "verify-email" | "reset-password" | "access";
type User = { name: string; email: string; email_verified_at: string | null; beta_status: "pending" | "approved" | "blocked" };
const titles: Record<Mode, string> = { login: "Entrar", register: "Criar sua conta", "forgot-password": "Recuperar senha", "verify-email": "Confirmar e-mail", "reset-password": "Nova senha", access: "Seu acesso ao beta" };
function nextDestination() {
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}
async function request(action: string, data?: Record<string, unknown>) {
  const response = await fetch(`/api/auth/${action}`, { method: data ? "POST" : "GET", cache: "no-store",
    headers: data ? { "Content-Type": "application/json" } : undefined, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir. Tente novamente.");
  return result;
}
export function AccountScreen({ mode, google = false }: { mode: Mode; google?: boolean }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(mode !== "access");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    async function initialize() {
      // Defer browser URL access until hydration. Never consume a token on a GET or preview.
      await Promise.resolve();
      if (!live) return;
      if (mode === "verify-email" || mode === "reset-password") {
        const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
        setToken(value);
        window.history.replaceState(null, "", window.location.pathname);
      }
      if (mode === "login" && new URLSearchParams(window.location.search).get("erro") === "google") setError("Não foi possível entrar com Google. Tente novamente ou entre com sua senha.");
      if (mode === "access") {
        try {
          const data = await request("session");
          if (live) { setUser(data.user); setLoaded(true); }
        } catch (e) { if (live) { setError((e as Error).message); setLoaded(true); } }
      }
    }
    void initialize();
    return () => { live = false; };
  }, [mode]);
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      if ((mode === "register" || mode === "reset-password") && password !== confirmPassword) throw new Error("As senhas não são iguais.");
      const action = mode === "access" ? "invite" : mode;
      const result = await request(action, { name, email, password, confirmPassword, token, code });
      if (mode === "login") {
        router.replace(result.user.email_verified_at && result.user.beta_status === "approved" ? nextDestination() : "/acesso");
        router.refresh();
      } else if (mode === "access") { router.replace("/"); router.refresh(); }
      else {
        setMessage(result.message || (mode === "verify-email" ? "E-mail confirmado. Entre para acompanhar seu acesso ao beta." : "Senha redefinida. Entre com sua nova senha."));
        setDone(true); setPassword(""); setConfirmPassword(""); setToken("");
      }
    });
  }
  const emailField = ["login", "register", "forgot-password"].includes(mode);
  const passwordField = ["login", "register", "reset-password"].includes(mode);
  return <main className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
    <div className="w-full max-w-[440px]">
      <div className="flex items-center gap-2.5 justify-center mb-6"><span className="w-8 h-8 rounded-[8px] bg-accent text-white grid place-items-center font-extrabold">B</span><strong>Build Agentflows</strong></div>
      <section className="card p-7 max-md:p-6">
        <h1 className="text-[22px] font-extrabold mb-2">{titles[mode]}</h1>
        <p className="text-muted text-sm mb-5">{mode === "register" ? "Crie sua conta e confirme seu e-mail. O beta exige um convite ou a liberação da equipe." : mode === "access" ? "Seus fluxos, conexões e bases de conhecimento ficam no seu espaço." : "Acesse seu espaço de agentes."}</p>
        {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
        {message && <p role="status" className="mb-4 text-sm">{message}</p>}
        {mode === "access" ? <>
          {!loaded ? <p role="status">Consultando seu acesso…</p> : !user ? <p><Link href="/entrar">Entre na sua conta</Link> para acompanhar sua liberação.</p> : <>
            <p className="mb-4 text-sm">Olá, {user.name}.</p>
            {user.beta_status === "blocked" ? <p role="status">Seu acesso está suspenso. Entre em contato com a equipe do beta.</p>
              : !user.email_verified_at ? <><p className="text-sm mb-4">Confirme o link enviado para {user.email} antes de utilizar seu convite.</p><button className="btn-primary" disabled={busy} onClick={() => void act(async () => { const result = await request("resend-verification", { email: user.email }); setMessage(result.message); })}>Reenviar confirmação</button></>
              : user.beta_status === "approved" ? <Link className="btn-primary" href="/">Abrir meu espaço</Link>
              : <><p className="text-sm mb-4">Você está na lista de espera. Se recebeu um convite, informe o código abaixo.</p><form onSubmit={submit}><label htmlFor="invite-code" className="block text-sm mb-2">Código do convite</label><input id="invite-code" className="input mb-3" value={code} onChange={(e) => setCode(e.target.value)} required minLength={8} maxLength={128} autoComplete="off" /><button className="btn-primary" disabled={busy}>{busy ? "Conferindo…" : "Usar convite"}</button></form><button className="mt-4 text-sm" disabled={busy} onClick={() => void act(async () => { const result = await request("session"); setUser(result.user); if (result.user?.beta_status !== "approved") setMessage("Seu acesso ainda está na lista de espera."); })}>Verificar liberação</button></>}
            <button className="block mt-5 text-sm" disabled={busy} onClick={() => void act(async () => { await request("logout", {}); router.replace("/entrar"); router.refresh(); })}>Sair da conta</button>
          </>}
        </> : !done && <form onSubmit={submit} className="space-y-4">
          {mode === "register" && <label className="block text-sm" htmlFor="name">Seu nome<input id="name" className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" /></label>}
          {emailField && <label className="block text-sm" htmlFor="email">E-mail<input id="email" className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" /></label>}
          {passwordField && <label className="block text-sm" htmlFor="password">Senha<input id="password" className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256} autoComplete={mode === "login" ? "current-password" : "new-password"} />{mode !== "login" && <span className="text-muted text-xs block mt-1">{REGRA_SENHA}</span>}</label>}
          {(mode === "register" || mode === "reset-password") && <label className="block text-sm" htmlFor="confirm-password">Confirmar senha<input id="confirm-password" className="input mt-1" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required maxLength={256} autoComplete="new-password" /></label>}
          {(mode === "verify-email" || mode === "reset-password") && !token && <p className="text-sm">Abra o link recebido por e-mail para continuar.</p>}
          <button className="btn-primary" disabled={busy || ((mode === "verify-email" || mode === "reset-password") && !token)}>{busy ? "Aguarde…" : titles[mode]}</button>
        </form>}
        {(mode === "login" || mode === "register") && google && <form action="/api/auth/google" method="get"><button className="btn-secondary block w-full text-center mt-4">Continuar com Google</button></form>}
        <nav aria-label="Opções de acesso" className="flex gap-4 flex-wrap mt-5 text-sm">
          {mode !== "login" && mode !== "access" && <Link href="/entrar">Entrar</Link>}
          {mode === "login" && <><Link href="/conta">Criar conta</Link><Link href="/recuperar-senha">Esqueci minha senha</Link></>}
          {mode === "verify-email" && <Link href="/acesso">Reenviar confirmação</Link>}
          {mode === "reset-password" && <Link href="/recuperar-senha">Pedir novo link</Link>}
        </nav>
      </section>
    </div>
  </main>;
}
