"use client";
// Telas "Criar sua conta" e "Entrar", compartilhadas pela suíte. Copie este arquivo para cada app sem alterar.
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Field } from "./ui";
import { REGRA_SENHA, emailInvalido, forcaSenha, senhaFraca } from "@/lib/conta-comum";

function proximoDestino() {
  const next = new URLSearchParams(location.search).get("next");
  return next || "/";
}

function Marca({ marca, nome }: { marca: string; nome: string }) {
  return (
    <div className="flex items-center gap-2.5 justify-center mb-6">
      <div className="w-8 h-8 rounded-[8px] bg-accent text-white grid place-items-center font-extrabold text-[14px]">{marca}</div>
      <span className="font-bold text-[15px]">{nome}</span>
    </div>
  );
}

function CaixaDeErro({ mensagem }: { mensagem: string }) {
  return <div className="mb-4 px-4 py-3 rounded-[10px] text-sm border bg-[#fde8e6] border-[#f5c2bd] text-danger">{mensagem}</div>;
}

type ErrosCriacao = Partial<Record<"nome" | "email" | "senha" | "confirmarSenha", string>>;

export function TelaCriarConta({ marca, nome: nomeApp }: { marca: string; nome: string }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [erros, setErros] = useState<ErrosCriacao>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [avisoDisco, setAvisoDisco] = useState(false);

  useEffect(() => {
    fetch("/api/conta").then((r) => r.json()).then((r) => {
      setAvisoDisco(Boolean(r.discoEfemero));
      if (r.existe) router.replace(`/entrar?next=${encodeURIComponent(proximoDestino())}`);
    }).catch(() => {});
  }, [router]);

  function validar(): ErrosCriacao {
    const novosErros: ErrosCriacao = {};
    if (!nome.trim()) novosErros.nome = "Escreva o seu nome.";
    const erroEmail = emailInvalido(email);
    if (erroEmail) novosErros.email = erroEmail;
    const erroSenha = senhaFraca(senha);
    if (erroSenha) novosErros.senha = erroSenha;
    else if (confirmarSenha !== senha) novosErros.confirmarSenha = "As senhas não são iguais.";
    return novosErros;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const novosErros = validar();
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) return;
    setEnviando(true);
    setErroGeral(null);
    try {
      const r = await fetch("/api/conta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, email, senha, confirmarSenha }) });
      const resposta = await r.json();
      if (!r.ok) throw new Error(resposta.error || "Não foi possível criar a conta.");
      location.href = proximoDestino();
    } catch (err) {
      setErroGeral(err instanceof Error ? err.message : "Não foi possível criar a conta.");
      setEnviando(false);
    }
  }

  const forca = forcaSenha(senha);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <Marca marca={marca} nome={nomeApp} />
        <div className="card p-7 max-md:p-6">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] mb-1.5">Criar sua conta</h1>
          <p className="text-muted text-[13.5px] mb-5">Nada sai daqui: seus dados ficam guardados só neste app, no seu servidor.</p>

          {erroGeral && <CaixaDeErro mensagem={erroGeral} />}

          <form onSubmit={onSubmit} noValidate>
            <Field label="Seu nome" htmlFor="nome" hint="Aparece só na tela.">
              <input id="nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
              {erros.nome && <p className="text-[12.5px] text-danger mt-1">{erros.nome}</p>}
            </Field>
            <Field label="E-mail" htmlFor="email" hint="Vai ser usado para entrar no app.">
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              {erros.email && <p className="text-[12.5px] text-danger mt-1">{erros.email}</p>}
            </Field>
            <Field label="Senha" htmlFor="senha" hint={REGRA_SENHA}>
              <input id="senha" type="password" className="input" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
              {senha && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex gap-1.5 flex-1" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full ${i < forca.nivel ? (forca.nivel <= 2 ? "bg-warn" : "bg-ok") : "bg-line"}`} />
                    ))}
                  </div>
                  <span className="text-[12px] text-muted shrink-0">{forca.rotulo}</span>
                </div>
              )}
              {erros.senha && <p className="text-[12.5px] text-danger mt-1">{erros.senha}</p>}
            </Field>
            <Field label="Confirmar senha" htmlFor="confirmarSenha">
              <input id="confirmarSenha" type="password" className="input" value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} autoComplete="new-password" />
              {erros.confirmarSenha && <p className="text-[12.5px] text-danger mt-1">{erros.confirmarSenha}</p>}
            </Field>
            <button type="submit" className="btn-primary mt-1" disabled={enviando}>{enviando ? "Criando conta" : "Criar conta e começar"}</button>
          </form>

          {avisoDisco && (
            <p className="text-muted text-[12px] mt-4">Neste plano a conta e as configurações se perdem a cada nova publicação. Para manter, a equipe técnica adiciona um disco em Opções avançadas do Blueprint.</p>
          )}
        </div>
      </div>
    </main>
  );
}

export function TelaEntrar({ marca, nome: nomeApp }: { marca: string; nome: string }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErroGeral(null);
    try {
      const r = await fetch("/api/conta/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, senha }) });
      const resposta = await r.json();
      if (!r.ok) throw new Error(resposta.error || "Não foi possível entrar.");
      location.href = proximoDestino();
    } catch (err) {
      setErroGeral(err instanceof Error ? err.message : "Não foi possível entrar.");
      setEnviando(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <Marca marca={marca} nome={nomeApp} />
        <div className="card p-7 max-md:p-6">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] mb-5">Entrar</h1>

          {erroGeral && <CaixaDeErro mensagem={erroGeral} />}

          <form onSubmit={onSubmit}>
            <Field label="E-mail" htmlFor="email">
              <input id="email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label="Senha" htmlFor="senha">
              <input id="senha" type="password" className="input" required value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
            </Field>
            <button type="submit" className="btn-primary mt-1" disabled={enviando}>{enviando ? "Entrando" : "Entrar"}</button>
          </form>
        </div>
      </div>
    </main>
  );
}
