"use client";
// Componentes visuais compartilhados pela suíte. Copie este arquivo para cada app sem alterar.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { CodigoErroIA, Meta } from "@/lib/ai";
import { numero, data } from "@/lib/formato";
import { NAVEGACAO, type ItemNavegacao } from "@/lib/navegacao";
import { ilustracaoDoSegmento, type Segmento } from "@/lib/ilustracao";
import { MODELOS_GRATUITOS, type ProximoPasso } from "@/lib/modelos";

export type UsuarioTopbar = { nome: string; email: string };
export type NotificacaoTopbar = { id: string; texto: string; url?: string };

export type Status = { ai: boolean; demo: boolean; model: string; integrations?: Record<string, boolean>; setup?: { pronto: boolean; url: string }; usuario?: UsuarioTopbar | null; proximos?: ProximoPasso[] };

export function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [erro, setErro] = useState(false);
  const router = useRouter();
  useEffect(() => {
    fetch("/api/status")
      .then((r) => {
        if (r.status === 401) {
          router.push(`/entrar?next=${encodeURIComponent(location.pathname)}`);
          return null;
        }
        return r.json();
      })
      .then((d) => d && setStatus(d))
      .catch(() => setErro(true));
  }, [router]);
  return { status, erro };
}

/** Fecha um popover/folha ao apertar Esc ou clicar fora dele; `setAberto` precisa ser um setState (identidade estável). */
function useFecharAoClicarFora(aberto: boolean, ref: RefObject<HTMLElement | null>, setAberto: (v: boolean) => void) {
  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickFora);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickFora);
    };
  }, [aberto, ref, setAberto]);
}

function iniciaisDe(nome: string) {
  return nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** Cabeçalho da suíte: marca à esquerda, navegação ao centro (desktop) e chip de status + sino + conta à direita; no celular a navegação e a conta viram um botão "Menu" com uma folha. */
export function Topbar({ marca, nome, area, status, erro, resumo, usuario, notificacoes, navegacao = NAVEGACAO }: { marca: string; nome: string; area: string; status: Status | null; erro?: boolean; resumo?: string; usuario?: UsuarioTopbar | null; notificacoes?: NotificacaoTopbar[]; navegacao?: ItemNavegacao[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const sair = () => { fetch("/api/conta/sair", { method: "POST" }).then(() => router.push("/entrar")); };
  const [popoverAberto, setPopoverAberto] = useState(false);
  const [sinoAberto, setSinoAberto] = useState(false);
  const [contaAberto, setContaAberto] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const sinoRef = useRef<HTMLDivElement>(null);
  const contaRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useFecharAoClicarFora(popoverAberto, popoverRef, setPopoverAberto);
  useFecharAoClicarFora(sinoAberto, sinoRef, setSinoAberto);
  useFecharAoClicarFora(contaAberto, contaRef, setContaAberto);
  useFecharAoClicarFora(menuAberto, menuRef, setMenuAberto);

  const texto = erro ? "Servidor indisponível" : !status ? "Verificando IA" : status.ai ? "IA conectada" : "Modo demonstração · conectar";
  const demo = status ? !status.ai : false;
  const estadoChip = erro || !status ? "pendente" : status.ai ? "conectado" : "demonstracao";
  const badge = (
    <span className={`chip-status chip-status-${estadoChip} min-w-[128px] justify-center max-md:min-w-0 max-md:px-2 max-md:text-[11px]`}>
      {texto}
      {estadoChip === "demonstracao" && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
      )}
    </span>
  );
  const proximos = status?.ai ? (status.proximos ?? []).slice(0, 3) : [];

  function ativo(href: string) {
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <header className={`no-print flex items-center gap-4 max-md:gap-2 px-8 py-3.5 max-md:px-4 max-md:py-3 bg-surface border-b border-line${process.env.NEXT_PUBLIC_APP_VERSION ? " max-md:flex-wrap" : ""}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-[34px] h-[34px] max-md:w-[30px] max-md:h-[30px] rounded-[9px] bg-accent text-white grid place-items-center font-extrabold text-[15px] max-md:text-[13px] tracking-tight">{marca}</div>
          <div className="min-w-0">
            <div className="font-bold text-[15px] max-md:text-sm max-md:leading-tight truncate">{nome}</div>
            {process.env.NEXT_PUBLIC_APP_VERSION ? (
              <div className="flex items-center gap-2 text-ink-2">
                <span className="text-[13px] max-md:hidden truncate">{area}</span>
                <span className="shrink-0 text-[10px] leading-tight tabular-nums" aria-label={`Versão ${process.env.NEXT_PUBLIC_APP_VERSION}`}>v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
              </div>
            ) : (
              <div className="text-ink-2 text-[13px] max-md:hidden truncate">{area}</div>
            )}
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 flex-1 justify-center min-w-0">
          {navegacao.map((item) => (
            <Link key={item.href} href={item.href} className={`text-[14px] font-semibold pb-1 border-b-2 ${ativo(item.href) ? "text-accent border-accent" : "text-ink-2 border-transparent hover:text-ink"}`}>
              {item.rotulo}
            </Link>
          ))}
        </nav>

        <div className={`flex items-center gap-2 max-md:gap-1.5 shrink-0 min-w-0${process.env.NEXT_PUBLIC_APP_VERSION ? " max-[380px]:flex-wrap max-[380px]:max-w-full" : ""}`}>
          {demo && resumo ? (
            <div className="relative" ref={popoverRef}>
              <button type="button" className="cursor-pointer" aria-haspopup="dialog" aria-expanded={popoverAberto} onClick={() => setPopoverAberto((v) => !v)}>
                {badge}
              </button>
              {popoverAberto && (
                <div role="dialog" className="absolute right-0 top-[calc(100%+8px)] z-20 w-72 max-md:w-64 card p-4 text-[13.5px] text-ink">
                  <p className="mb-3">{resumo}</p>
                  <Link href="/setup" className="font-bold text-accent underline underline-offset-2" onClick={() => setPopoverAberto(false)}>Conectar a IA em 1 minuto</Link>
                </div>
              )}
            </div>
          ) : demo ? (
            <Link href="/setup#openrouter" className="cursor-pointer">{badge}</Link>
          ) : proximos.length > 0 ? (
            <div className="relative" ref={popoverRef}>
              <button type="button" className="cursor-pointer" aria-haspopup="dialog" aria-expanded={popoverAberto} onClick={() => setPopoverAberto((v) => !v)}>
                {badge}
              </button>
              {popoverAberto && (
                <div role="dialog" className="absolute right-0 top-[calc(100%+8px)] z-20 w-72 max-md:w-64 card p-1.5 text-[13.5px] text-ink">
                  <p className="font-bold px-3 pt-2 pb-1">Faz mais com...</p>
                  {proximos.map((p) => (
                    <Link key={p.id} href={p.url} className="block px-3 py-2 rounded-md hover:bg-accent-soft" onClick={() => setPopoverAberto(false)}>
                      <span className="block font-semibold text-ink">{p.titulo}</span>
                      <span className="block text-ink-2 text-[12.5px]">{p.beneficio}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : badge}

          <Link href="/setup" aria-label="Configurações" className="md:hidden shrink-0 w-[30px] h-[30px] rounded-full grid place-items-center hover:bg-bg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 13.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V4a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V10a1.65 1.65 0 0 0 1.51 1H20a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
          </Link>

          {notificacoes && notificacoes.length > 0 && (
            <div className="relative max-md:hidden" ref={sinoRef}>
              <button type="button" className="relative w-8 h-8 grid place-items-center rounded-full hover:bg-bg cursor-pointer" aria-haspopup="dialog" aria-expanded={sinoAberto} aria-label={`${notificacoes.length} avisos`} onClick={() => setSinoAberto((v) => !v)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center">{notificacoes.length}</span>
              </button>
              {sinoAberto && (
                <div role="dialog" className="absolute right-0 top-[calc(100%+8px)] z-20 w-80 max-md:w-64 card p-1.5 text-[13.5px] text-ink">
                  {notificacoes.map((n) =>
                    n.url ? (
                      <Link key={n.id} href={n.url} className="block px-3 py-2 rounded-md hover:bg-accent-soft" onClick={() => setSinoAberto(false)}>{n.texto}</Link>
                    ) : (
                      <p key={n.id} className="px-3 py-2">{n.texto}</p>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {usuario && (
            <div className="relative max-md:hidden" ref={contaRef}>
              <button type="button" className="w-8 h-8 rounded-full bg-accent text-white grid place-items-center font-bold text-[12.5px] cursor-pointer" aria-haspopup="dialog" aria-expanded={contaAberto} aria-label="Sua conta" onClick={() => setContaAberto((v) => !v)}>
                {iniciaisDe(usuario.nome)}
              </button>
              {contaAberto && (
                <div role="dialog" className="absolute right-0 top-[calc(100%+8px)] z-20 w-64 card p-4 text-[13.5px]">
                  <div className="font-bold text-ink">{usuario.nome}</div>
                  <div className="text-ink-2 mb-3 truncate">{usuario.email}</div>
                  <button type="button" className="btn-link" onClick={sair}>Sair</button>
                </div>
              )}
            </div>
          )}

          <button type="button" className="md:hidden shrink-0 inline-flex items-center gap-1 h-[30px] px-2 rounded-field border border-line bg-surface text-ink text-[12px] font-semibold cursor-pointer" aria-haspopup="dialog" aria-expanded={menuAberto} onClick={() => setMenuAberto(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            Menu
          </button>
        </div>
      </header>

      {menuAberto && (
        <div className="md:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuAberto(false)} />
          <div ref={menuRef} role="dialog" aria-label="Menu" className="absolute top-0 right-0 bottom-0 w-[80%] max-w-[300px] bg-surface p-5 flex flex-col gap-1 shadow-card overflow-y-auto">
            <button type="button" className="self-end text-ink-2 mb-3 cursor-pointer" aria-label="Fechar menu" onClick={() => setMenuAberto(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>
            </button>
            {navegacao.map((item) => (
              <Link key={item.href} href={item.href} className={`px-3 py-2.5 rounded-md font-semibold ${ativo(item.href) ? "text-accent bg-accent-soft" : "text-ink"}`} onClick={() => setMenuAberto(false)}>{item.rotulo}</Link>
            ))}
            {usuario && (
              <div className="mt-4 pt-4 border-t border-line">
                <div className="font-bold text-ink px-3">{usuario.nome}</div>
                <div className="text-ink-2 text-[13px] px-3 mb-3 truncate">{usuario.email}</div>
                <button type="button" className="btn-link px-3" onClick={sair}>Sair</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function Workspace({ children }: { children: ReactNode }) {
  return <main className="grid grid-cols-[minmax(320px,420px)_1fr] max-md:grid-cols-1 gap-7 px-8 pt-7 pb-12 max-md:px-4 max-md:pt-5 max-md:pb-10 max-w-[1400px] mx-auto [&>*]:min-w-0">{children}</main>;
}

/** Topo da tela principal (referência visual de 15/09/2026): sobretítulo no acento, título de duas linhas,
 * frase de apoio e a ilustração do segmento à direita. Os textos são sempre passados pelo app (constante
 * `PROMESSA`), nunca fixos aqui. Sem ilustração no celular (breakpoint já resolvido em `IlustracaoSegmento`). */
export function Hero({ sobretitulo, titulo, apoio, segmento, children }: { sobretitulo: string; titulo: string; apoio: string; segmento: Segmento; children?: ReactNode }) {
  return (
    <section className="no-print px-8 pt-6 max-md:px-4 max-md:pt-5 max-w-[1400px] mx-auto">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] max-md:grid-cols-1 gap-8 items-center">
        <div>
          <p className="sobretitulo mb-1">{sobretitulo}</p>
          <h1 className="titulo-painel max-w-[560px] mb-2">{titulo}</h1>
          <p className="text-[15px] text-ink-2 leading-snug max-w-[520px] mb-3">{apoio}</p>
          {children}
        </div>
        <div className="relative w-[130px] shrink-0 max-md:hidden">
          <div className="blob-acento" />
          <IlustracaoSegmento segmento={segmento} loading="eager" className="relative w-full h-auto" />
        </div>
      </div>
    </section>
  );
}

export type PassoIndicador = { titulo: string; apoio: string };

/** Indicador de progresso (referência visual de 15/09/2026): três etapas numeradas, a atual no acento e as
 * demais em cinza. É só indicador — nunca navegação, não recebe clique. Rola na horizontal no celular. */
export function Passos({ passos, atual }: { passos: PassoIndicador[]; atual: number }) {
  return (
    <ol className="no-print flex gap-7 max-md:gap-5 max-md:overflow-x-auto max-md:pb-1">
      {passos.map((p, i) => {
        const numero = i + 1;
        const ativo = numero === atual;
        return (
          <li key={p.titulo} className={`flex items-baseline gap-1.5 shrink-0 ${ativo ? "text-accent" : "text-ink-2"}`}>
            <span className="font-extrabold text-[13px]">{numero}</span>
            <span className={`text-[13px] ${ativo ? "font-bold" : ""}`}>{p.titulo}</span>
            <span className="text-[12px] max-md:hidden">· {p.apoio}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Panel({ titulo, lead, children }: { titulo: string; lead: string; children: ReactNode }) {
  return (
    <section className="no-print card p-7 max-md:p-[22px] self-start md:sticky md:top-6 md:max-h-[calc(100vh-48px)] md:overflow-y-auto">
      <h1 className="text-[26px] max-md:text-[24px] leading-[1.15] font-extrabold tracking-[-0.025em] mb-2.5">{titulo}</h1>
      <p className="text-muted mb-6">{lead}</p>
      {children}
    </section>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 mb-4 min-w-0 [&>*]:min-w-0">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">{label}</label>
      {children}
      {hint && <span className="text-[12.5px] text-muted">{hint}</span>}
    </div>
  );
}

/** <details> com o mesmo espaçamento vertical dos Field; agrupa campos secundários fora do fluxo principal do painel. */
export function MaisDetalhes({ titulo = "Mais detalhes", children }: { titulo?: string; children: ReactNode }) {
  return (
    <details className="group mb-4">
      <summary className="text-[13px] font-semibold cursor-pointer select-none marker:content-none flex items-center gap-1.5">
        <span className="text-muted transition-transform group-open:rotate-90">›</span>
        {titulo}
      </summary>
      <div className="mt-3.5 [&>*:last-child]:mb-0">{children}</div>
    </details>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3 [&>*]:min-w-0">{children}</div>;
}

export function Stage({ children }: { children: ReactNode }) {
  return <section id="stage" className="min-h-[520px] max-md:min-h-0">{children}</section>;
}

/** Ilustração (SVG inline, 64 px, traço 1,5 px) no lugar de um glifo genérico; cada app entrega a sua. */
export function Empty({ ilustracao, titulo, descricao, acao, onAcao, acaoSecundaria }: { ilustracao: ReactNode; titulo: string; descricao: string; acao?: string; onAcao?: () => void; acaoSecundaria?: { rotulo: string; url: string } }) {
  return (
    <div className="h-full min-h-[520px] max-md:min-h-[320px] flex flex-col items-center justify-center text-center text-muted p-10 max-md:px-4 max-md:py-7 border border-dashed border-line rounded-card">
      <div className="text-accent mb-[18px]">{ilustracao}</div>
      <h2 className="text-ink text-lg font-bold mb-1.5">{titulo}</h2>
      <p className="max-w-[380px]">{descricao}</p>
      {acao && onAcao && <button type="button" className="btn-link mt-1" onClick={onAcao}>{acao}</button>}
      {acaoSecundaria && <Link href={acaoSecundaria.url} className="btn-link mt-1">{acaoSecundaria.rotulo}</Link>}
    </div>
  );
}

/**
 * Ilustração de pessoa do segmento (ver lib/ilustracao.ts), decorativa e ausente no celular por design
 * (o hero do celular não a mostra): sem `<source>` casando com a media abaixo de 768 px, o `<img>` sem
 * `src` não baixa nada. Segmentos sem ilustração pronta (Estratégia, Gestão, Jurídico) não renderizam
 * nada — o app fica só com `.blob-acento`.
 */
export function IlustracaoSegmento({ segmento, loading = "lazy", className }: { segmento: Segmento; loading?: "lazy" | "eager"; className?: string }) {
  const ilustracao = ilustracaoDoSegmento(segmento);
  if (!ilustracao) return null;
  const { nome, variantes } = ilustracao;
  const base = variantes[0];
  const srcSet = variantes.map((v) => `/ilustracoes/${nome}-${v.largura}.webp ${v.largura}w`).join(", ");
  return (
    <picture>
      <source media="(min-width: 768px)" srcSet={srcSet} type="image/webp" />
      <img alt="" aria-hidden="true" width={base.largura} height={base.altura} loading={loading} className={className} />
    </picture>
  );
}

/** Com `etapas`, troca a frase a cada 1,2 s parando na última; `texto` continua aceito para uma frase fixa. */
export function Loading({ texto, etapas }: { texto?: string; etapas?: string[] }) {
  const [indice, setIndice] = useState(0);
  useEffect(() => {
    if (!etapas || etapas.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setIndice((i) => {
        if (i >= etapas.length - 1) {
          clearInterval(id);
          return i;
        }
        return i + 1;
      });
    }, 1200);
    return () => clearInterval(id);
  }, [etapas]);

  const frase = etapas && etapas.length > 0 ? etapas[indice] : texto ?? "";
  return (
    <div className="flex flex-col gap-3.5 py-2" aria-live="polite">
      <p className="text-muted text-sm">{frase}</p>
      <div className="skeleton h-11 w-4/5" />
      <div className="skeleton w-3/5" />
      <div className="skeleton w-[70%]" />
      <div className="skeleton h-11 w-[90%]" />
      <div className="skeleton w-1/2" />
    </div>
  );
}

function tituloErro(codigo?: CodigoErroIA): string {
  if (codigo === "sem_credito") return "A IA está sem crédito";
  if (codigo === "limite_diario") return "Limite diário atingido";
  if (codigo === "modelo_indisponivel") return "Modelo indisponível";
  if (codigo === "chave_invalida") return "Entre de novo";
  return "Não deu certo";
}

/** Rola até si mesma no celular ao aparecer (mesmo critério de useScrollToResult); onTentarNovamente exibe o botão "Tentar de novo". `codigo`/`acao` vêm de ErroIA (lib/ai.ts, ver respostaErro). */
export function ErrorBox({ mensagem, codigo, acao, onTentarNovamente }: { mensagem: string; codigo?: CodigoErroIA; acao?: { rotulo: string; url: string }; onTentarNovamente?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [trocandoModelo, setTrocandoModelo] = useState(false);
  useEffect(() => {
    if (podeRolarAutomaticamente()) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  async function usarModeloGratuito() {
    setTrocandoModelo(true);
    try {
      const status: { model?: string } = await fetch("/api/status").then((r) => r.json());
      const gratuito = MODELOS_GRATUITOS.find((m) => m.valor.endsWith(":free") && m.valor !== status.model);
      if (gratuito) {
        await fetch("/api/setup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores: { OPENROUTER_MODEL: gratuito.valor } }) });
      }
      onTentarNovamente?.();
    } finally {
      setTrocandoModelo(false);
    }
  }

  const ofereceModeloGratuito = codigo === "sem_credito" || codigo === "limite_diario";

  return (
    <div ref={ref} className="bg-[#fde8e6] border border-[#f5c2bd] text-danger px-4 py-3.5 rounded-[10px]">
      <strong>{tituloErro(codigo)}.</strong> {mensagem}
      {(onTentarNovamente || acao || ofereceModeloGratuito) && (
        <div className="mt-3 flex gap-2.5 flex-wrap">
          {ofereceModeloGratuito && (
            <button type="button" className="btn-primary !w-auto" onClick={usarModeloGratuito} disabled={trocandoModelo}>
              {trocandoModelo ? "Trocando..." : "Usar um modelo gratuito"}
            </button>
          )}
          {acao && (
            <a
              className="btn-primary !w-auto"
              href={acao.url}
              target={acao.url.startsWith("http") ? "_blank" : undefined}
              rel={acao.url.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              {acao.rotulo}
            </a>
          )}
          {onTentarNovamente && <button type="button" className="btn-ghost" onClick={onTentarNovamente}>Tentar de novo</button>}
        </div>
      )}
    </div>
  );
}

const TONS_AVISO: Record<"ok" | "warn" | "danger", string> = {
  ok: "bg-[#e4f4ec] border-[#bfe3d0] text-ok",
  warn: "bg-[#fff4e0] border-[#f0d999] text-warn",
  danger: "bg-[#fde8e6] border-[#f5c2bd] text-danger",
};

/** Aviso inline (não é `window.alert`): aparece no lugar da tela onde o problema ocorreu, nunca num popup do navegador. `acao` é um link (`url`) ou um botão (`onClick`). */
export function Aviso({ tom = "warn", children, acao }: { tom?: "ok" | "warn" | "danger"; children: ReactNode; acao?: { rotulo: string; url?: string; onClick?: () => void } }) {
  return (
    <div className={`px-4 py-3 rounded-[10px] text-sm border ${TONS_AVISO[tom]}`}>
      {children}
      {acao && (
        <div className="mt-2.5">
          {acao.url ? (
            <a className="btn-link text-[13px]" href={acao.url}>{acao.rotulo}</a>
          ) : (
            <button type="button" className="btn-link text-[13px]" onClick={acao.onClick}>{acao.rotulo}</button>
          )}
        </div>
      )}
    </div>
  );
}

type PedidoConfirmacao = { mensagem: string; confirmarRotulo: string; cancelarRotulo: string; resolver: (v: boolean) => void };

/** Diálogo de confirmação da suíte, no lugar de `window.confirm` (reservado só para "Apagar tudo"). Renderize `Dialogo` uma vez na árvore do componente; `confirmar(mensagem)` devolve uma Promise<boolean>. */
export function useConfirmacao() {
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  function confirmar(mensagem: string, opcoes?: { confirmarRotulo?: string; cancelarRotulo?: string }): Promise<boolean> {
    return new Promise((resolver) => {
      setPedido({ mensagem, confirmarRotulo: opcoes?.confirmarRotulo ?? "Confirmar", cancelarRotulo: opcoes?.cancelarRotulo ?? "Cancelar", resolver });
    });
  }

  function responder(v: boolean) {
    pedido?.resolver(v);
    setPedido(null);
  }

  const Dialogo = pedido ? (
    <div className="fixed inset-0 z-30 bg-black/40 grid place-items-center px-4" role="presentation">
      <div ref={ref} role="alertdialog" aria-modal="true" className="card w-full max-w-[400px] p-6">
        <p className="text-[15px] mb-5">{pedido.mensagem}</p>
        <div className="flex gap-2.5 justify-end">
          <button type="button" className="btn-ghost !w-auto" onClick={() => responder(false)}>{pedido.cancelarRotulo}</button>
          <button type="button" className="btn-primary !w-auto" onClick={() => responder(true)}>{pedido.confirmarRotulo}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmar, Dialogo };
}

export type ErroLido = { mensagem: string; codigo?: string; acao?: { rotulo: string; url: string } };

/** Lê o erro de uma `Response` de `fetch` (tenta `{error,codigo,acao}` em JSON) ou de uma exceção de rede (o próprio `fetch` lançando). Nunca expõe status HTTP cru nem corpo do servidor na tela: qualquer falha de leitura cai num dos dois fallbacks fixos. */
export async function lerErro(r: Response | unknown): Promise<ErroLido> {
  if (r instanceof Response) {
    try {
      const corpo = await r.json();
      if (corpo && typeof corpo.error === "string") {
        return { mensagem: corpo.error, codigo: corpo.codigo, acao: corpo.acao };
      }
    } catch {
      // corpo não é JSON (ex.: página de erro em HTML) — cai no fallback abaixo
    }
    return { mensagem: "O servidor não respondeu como esperado. Recarregue a página e tente de novo." };
  }
  console.error(r);
  return { mensagem: "Não conseguimos falar com o app. Verifique a conexão e tente de novo." };
}

export function ResultHead({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children?: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 mb-5 max-md:flex-wrap">
      <div>
        <h2 className="text-xl font-extrabold tracking-[-0.01em]">{titulo}</h2>
        {subtitulo && <div className="text-muted text-sm">{subtitulo}</div>}
      </div>
      {children && <div className="no-print flex gap-2.5 shrink-0 max-md:flex-wrap max-md:w-full [&>*]:max-md:flex-1">{children}</div>}
    </div>
  );
}

/** Linha de proveniência do resultado: de onde veio e quando. O nome do modelo só aparece no title.
 * `demoTexto` (frase por app) substitui a frase padrão quando o app ignora a entrada da pessoa em modo
 * demonstração (ex.: sobe o próprio arquivo e recebe um exemplo fixo) — sem ele, mantém a frase padrão. */
export function Origem({ meta, demoTexto }: { meta: Meta; demoTexto?: string }) {
  if (!meta.demo) {
    return <p className="text-muted text-[13px] mb-4" title={meta.model}>{`Gerado com IA a partir de ${meta.insumo}, em ${data(meta.geradoEm, { comHora: true })}`}</p>;
  }
  return (
    <p className="text-muted text-[13px] mb-4" title={meta.model}>
      {demoTexto ?? `Exemplo ilustrativo a partir de ${meta.insumo}.`}{" "}
      <Link href="/setup#openrouter" className="font-semibold text-accent underline underline-offset-2">
        {demoTexto ? "Conectar a IA" : "Conecte a IA para usar os seus dados"}
      </Link>
    </p>
  );
}

/** Selo no rodapé do resultado: só diz "Gerado com Inteligência Artificial" quando a IA gerou de verdade;
 * em modo demonstração o selo avisa que é exemplo, para nunca sugerir que uma IA rodou sem estar conectada. */
export function SeloIA({ demo }: { demo: boolean }) {
  return (
    <p className="text-center mt-6">
      <span className={demo ? "chip-cinza" : "chip-neutral"}>{demo ? "Exemplo, sem usar IA" : "Gerado com Inteligência Artificial"}</span>
    </p>
  );
}

const CORES_TOM: Record<string, string> = { ok: "text-ok", warn: "text-warn", danger: "text-danger", neutro: "text-accent-ink" };

/** Dado que decide, exibido antes do resumo: um número grande com rótulo e interpretação. */
export function Destaque({ valor, rotulo, interpretacao, tom = "neutro" }: { valor: string; rotulo: string; interpretacao?: string; tom?: "ok" | "warn" | "danger" | "neutro" }) {
  return (
    <div className="mb-6">
      <div className={`text-[40px] max-sm:text-[32px] leading-none font-extrabold tracking-[-0.02em] text-balance ${CORES_TOM[tom]}`}>{valor}</div>
      <div className="text-[13px] font-semibold text-muted mt-2">{rotulo}</div>
      {interpretacao && <div className="text-sm text-muted mt-1">{interpretacao}</div>}
    </div>
  );
}

export function Section({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="section-title">{titulo}</h2>
      {children}
    </div>
  );
}

export function Item({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card shadow-none px-5 py-[18px] ${className}`}>{children}</div>;
}

const ROTULOS_NIVEL: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa", positivo: "Positivo", neutro: "Neutro", negativo: "Negativo" };

function sentenceCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Sem children, mostra o rótulo humano do nível (ex.: "alta" → "Alta"); níveis fora do mapa padrão caem no sentence case do próprio texto. */
export function Chip({ nivel, children }: { nivel: string; children?: ReactNode }) {
  const classe = nivel.toLowerCase().replace("é", "e");
  return <span className={`chip-${classe}`}>{children ?? ROTULOS_NIVEL[classe] ?? sentenceCase(nivel)}</span>;
}

export type Coluna<T> = {
  chave: string;
  titulo: string;
  render: (linha: T) => ReactNode;
  classe?: string;
  /** No celular: "titulo" (negrito, cabeçalho do cartão), "resumo" (algumas linhas, logo abaixo), "chip" (à direita do título) ou "detalhe" (dentro de "Ver mais"). Sem papel, mantém o rótulo acima do valor. */
  papel?: "titulo" | "resumo" | "chip" | "detalhe";
  /** Só para papel "resumo": quantas linhas mostrar antes de cortar (padrão 2). */
  linhas?: number;
  /** No desktop, aplica width fixa à coluna (ex.: "20%", "120px"). */
  largura?: string;
};

/** Texto de uma coluna "resumo": até `linhas` linhas (padrão 2), com "Ver mais" só quando o texto realmente estoura o limite (medido por scrollHeight/clientHeight, não decorativo). Passando `aberto`/`onEstouro` de fora (cartão do celular), o botão próprio some (`semBotao`) e quem decide abrir/fechar é o chamador — assim resumo e detalhes abrem juntos, atrás de um único "Ver mais". */
function ResumoCelula({ children, linhas = 2, aberto: abertoControlado, onEstouro, semBotao = false }: { children: ReactNode; linhas?: number; aberto?: boolean; onEstouro?: (estourou: boolean) => void; semBotao?: boolean }) {
  const [abertoProprio, setAbertoProprio] = useState(false);
  const [estourou, setEstourou] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const aberto = abertoControlado ?? abertoProprio;

  useEffect(() => {
    if (aberto) return;
    const el = ref.current;
    if (!el) return;
    const estoura = el.scrollHeight > el.clientHeight + 1;
    setEstourou(estoura);
    onEstouro?.(estoura);
  }, [children, linhas, aberto, onEstouro]);

  return (
    <div>
      <div ref={ref} className={aberto ? "" : "overflow-hidden"} style={aberto ? undefined : { display: "-webkit-box", WebkitLineClamp: linhas, WebkitBoxOrient: "vertical" }}>
        {children}
      </div>
      {!semBotao && estourou && !aberto && (
        <button type="button" className="btn-link text-[12.5px] mt-1" onClick={() => setAbertoProprio(true)}>Ver mais</button>
      )}
    </div>
  );
}

/** Um cartão do `DataTable` no celular: resumo (quando estoura) e detalhes atrás de um único "Ver mais" — nunca dois botões separados no mesmo cartão. */
function CartaoLinha<T>({ linha, titulo, resumo, chip, semPapel, detalhes }: { linha: T; titulo?: Coluna<T>; resumo?: Coluna<T>; chip?: Coluna<T>; semPapel: Coluna<T>[]; detalhes: Coluna<T>[] }) {
  const [aberto, setAberto] = useState(false);
  const [resumoEstourou, setResumoEstourou] = useState(false);
  const temMais = resumoEstourou || detalhes.length > 0;

  return (
    <div className="px-3.5 py-2.5 flex flex-col gap-1.5">
      {(titulo || chip) && (
        <div className="flex items-start justify-between gap-2">
          {titulo && <div className="font-bold">{titulo.render(linha)}</div>}
          {chip && <div className="shrink-0">{chip.render(linha)}</div>}
        </div>
      )}
      {resumo && (
        <div className="text-muted">
          <ResumoCelula linhas={resumo.linhas} aberto={aberto} onEstouro={setResumoEstourou} semBotao>{resumo.render(linha)}</ResumoCelula>
        </div>
      )}
      {semPapel.map((c) => (
        <div key={c.chave}>
          <div className="text-[11.5px] font-bold text-muted">{c.titulo}</div>
          <div>{c.render(linha)}</div>
        </div>
      ))}
      {aberto && detalhes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {detalhes.map((c) => (
            <div key={c.chave}>
              <div className="text-[11.5px] font-bold text-muted">{c.titulo}</div>
              <div>{c.render(linha)}</div>
            </div>
          ))}
        </div>
      )}
      {temMais && (
        <button type="button" className="text-[13px] font-bold text-accent-ink text-left" onClick={() => setAberto((v) => !v)}>
          {aberto ? "Ver menos" : "Ver mais"}
        </button>
      )}
    </div>
  );
}

/** Tabela responsiva: linhas no desktop, cartões no celular (título + resumo + chip visíveis, detalhes atrás de "Ver mais"). */
export function DataTable<T>({ colunas, linhas }: { colunas: Coluna<T>[]; linhas: T[] }) {
  const titulo = colunas.find((c) => c.papel === "titulo");
  const resumo = colunas.find((c) => c.papel === "resumo");
  const chip = colunas.find((c) => c.papel === "chip");
  const detalhes = colunas.filter((c) => c.papel === "detalhe");
  const semPapel = colunas.filter((c) => !c.papel);

  return (
    <>
      <table className="max-md:hidden w-full border-collapse text-sm card shadow-none overflow-hidden">
        <thead>
          <tr>{colunas.map((c) => <th key={c.chave} style={c.largura ? { width: c.largura } : undefined} className="text-left px-3.5 py-[11px] border-b border-line font-bold text-[13px] text-muted bg-[#fafbfc]">{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="[&:last-child>td]:border-b-0">
              {colunas.map((c) => <td key={c.chave} style={c.largura ? { width: c.largura } : undefined} className={`px-3.5 py-[11px] border-b border-line align-top ${c.classe ?? ""}`}>{c.papel === "resumo" ? <ResumoCelula linhas={c.linhas}>{c.render(l)}</ResumoCelula> : c.render(l)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="md:hidden card shadow-none divide-y divide-line text-sm">
        {linhas.map((l, i) => (
          <CartaoLinha key={i} linha={l} titulo={titulo} resumo={resumo} chip={chip} semPapel={semPapel} detalhes={detalhes} />
        ))}
      </div>
    </>
  );
}

/** Área de upload tracejada compartilhada: arrastar e soltar ou clicar para selecionar; nome do arquivo escolhido fica visível. */
export function Dropzone({ id = "dropzone-arquivo", accept, tiposLabel, maxSizeMB, arquivo, onArquivo }: { id?: string; accept: string; tiposLabel: string; maxSizeMB: number; arquivo: File | null; onArquivo: (file: File | null) => void }) {
  const [arrastando, setArrastando] = useState(false);
  const ativo = arrastando || !!arquivo;

  return (
    <label
      htmlFor={id}
      onDragEnter={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={(e) => { e.preventDefault(); setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); onArquivo(e.dataTransfer.files?.[0] ?? null); }}
      className={`flex flex-col items-center justify-center gap-1.5 text-center py-9 px-4 rounded-card border-[1.5px] border-dashed cursor-pointer transition-colors ${ativo ? "border-accent bg-accent-soft" : "border-line text-muted"}`}
    >
      <input id={id} type="file" accept={accept} hidden onChange={(e) => onArquivo(e.target.files?.[0] ?? null)} />
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={ativo ? "text-accent" : "text-muted"}>
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <strong className="text-ink text-[14.5px] font-bold">Arraste o arquivo aqui ou selecione</strong>
      <span className="text-[12.5px]">{tiposLabel}, até {maxSizeMB} MB</span>
      {arquivo && <span className="mt-1 text-[13px] font-bold text-accent-ink">{arquivo.name}</span>}
    </label>
  );
}

/** Frase padrão de privacidade do rodapé; `detalhe` acrescenta contexto específico do app só no title. */
export function Privacidade({ detalhe }: { detalhe?: string }) {
  return (
    <p className="mt-3.5 text-muted text-[12.5px]" title={detalhe}>Seus dados ficam só neste app e você pode apagar quando quiser.</p>
  );
}

/** Opt-in de guarda temporária, exibido só nos apps com lib/historico.ts SENSIVEL = true (dados sensíveis não ficam salvos por padrão). */
export function OptInGuardar({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] mb-4 cursor-pointer">
      <input type="checkbox" className="w-4 h-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Guardar este resultado por 30 dias
    </label>
  );
}

/** Bloco de entrega padrão: baixar PDF (abre /imprimir/<id>; sem id imprime a própria tela) e um menu "Mais" com copiar texto, e-mail, link e extras do app. */
export function Entregar({ id, titulo, texto, extras }: { id?: string; titulo: string; texto: () => string; extras?: { rotulo: string; onClick: () => void }[] }) {
  const [aberto, setAberto] = useState(false);
  const [copiadoTexto, setCopiadoTexto] = useState(false);
  const [copiadoLink, setCopiadoLink] = useState(false);
  const [falhaCopia, setFalhaCopia] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    function onClickFora(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickFora);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickFora);
    };
  }, [aberto]);

  async function copiar(t: string, marcar: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(t);
      marcar(true);
      setTimeout(() => marcar(false), 1800);
    } catch {
      setFalhaCopia(true);
      setTimeout(() => setFalhaCopia(false), 4000);
    }
    setAberto(false);
  }

  const link = id && typeof window !== "undefined" ? `${location.origin}/r/${id}` : undefined;
  const itemClasse = "w-full text-left px-3 py-2 rounded-md hover:bg-accent-soft cursor-pointer";

  return (
    <div className="flex flex-col gap-2.5 max-md:w-full">
      <div className="flex gap-2.5 max-md:w-full">
        <button type="button" className="btn-primary !w-auto max-md:flex-1" onClick={() => (id ? window.open(`/imprimir/${id}`, "_blank") : window.print())}>Baixar PDF</button>
        <div className="relative shrink-0" ref={menuRef}>
          <button type="button" className="btn-ghost" aria-haspopup="menu" aria-expanded={aberto} aria-label="Mais opções para entregar este resultado" onClick={() => setAberto((v) => !v)}>
            <span className="max-md:hidden">Mais</span>
            <svg className="md:hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
          {aberto && (
            <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-20 w-56 card p-1.5 text-[13.5px]">
              <button type="button" role="menuitem" className={itemClasse} onClick={() => copiar(texto(), setCopiadoTexto)}>{copiadoTexto ? "Copiado" : "Copiar texto"}</button>
              <a role="menuitem" className={`${itemClasse} block`} href={`mailto:?subject=${encodeURIComponent(titulo)}&body=${encodeURIComponent(texto())}`} onClick={() => setAberto(false)}>Enviar por e-mail</a>
              {link && <button type="button" role="menuitem" className={itemClasse} onClick={() => copiar(link, setCopiadoLink)}>{copiadoLink ? "Copiado" : "Copiar link"}</button>}
              {extras?.map((ex) => (
                <button key={ex.rotulo} type="button" role="menuitem" className={itemClasse} onClick={() => { ex.onClick(); setAberto(false); }}>{ex.rotulo}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {falhaCopia && <Aviso tom="danger">Não foi possível copiar automaticamente. Selecione o texto e copie com Ctrl+C (ou Cmd+C no Mac).</Aviso>}
    </div>
  );
}

export function CopyButton({ texto, rotulo = "Copiar texto" }: { texto: () => string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  const [falha, setFalha] = useState(false);
  return (
    <div className="inline-flex flex-col gap-2 items-start">
      <button type="button" className="btn-ghost" onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto());
          setOk(true);
          setTimeout(() => setOk(false), 1800);
        } catch {
          setFalha(true);
          setTimeout(() => setFalha(false), 4000);
        }
      }}>{ok ? "Copiado" : rotulo}</button>
      {falha && <Aviso tom="danger">Não foi possível copiar automaticamente. Selecione o texto e copie com Ctrl+C (ou Cmd+C no Mac).</Aviso>}
    </div>
  );
}

function podeRolarAutomaticamente() {
  return window.innerWidth <= 768 && !location.search.includes("captura");
}

/** No celular, rola até o resultado quando ele aparece (desligado com ?captura=1). */
export function useScrollToResult(pronto: boolean) {
  useEffect(() => {
    if (!pronto || !podeRolarAutomaticamente()) return;
    document.getElementById("stage")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pronto]);
}

export function esc(s: unknown) { return String(s ?? ""); }

/** Reexportados para não quebrar quem já importa esses helpers de "@/components/ui"; definidos em lib/formato.ts (sem "use client") para poderem ser chamados também de Server Components. */
export { numero, data };
