"use client";
// Formulário público genérico (marca do app, título, campos declarados, botão "Enviar"), renderizado
// a partir do que o app registrou em lib/formularios.ts. Copie este arquivo junto com page.tsx sem alterar.
import { useState, type FormEvent } from "react";
import type { CampoFormulario } from "@/lib/formularios";

type Props = { token: string; marca: string; nome: string; titulo: string; descricao?: string; agradecimento?: string; campos: CampoFormulario[] };

type Fase = "preenchendo" | "enviando" | "enviado" | "erro";

export function FormularioPublico({ token, marca, nome, titulo, descricao, agradecimento, campos }: Props) {
  const [dados, setDados] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => [c.chave, ""])));
  const [nomesArquivo, setNomesArquivo] = useState<Record<string, string>>({});
  const [armadilha, setArmadilha] = useState("");
  const [fase, setFase] = useState<Fase>("preenchendo");
  const [mensagemErro, setMensagemErro] = useState("");

  const set = (chave: string) => (e: { target: { value: string } }) => setDados((d) => ({ ...d, [chave]: e.target.value }));

  async function setArquivo(chave: string, arquivo: File | null) {
    if (!arquivo) return;
    const texto = await arquivo.text();
    setDados((d) => ({ ...d, [chave]: texto }));
    setNomesArquivo((n) => ({ ...n, [chave]: arquivo.name }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Campos "nota"/"decisao"/"escala"/"escolha" são grupos de botões, sem validação nativa de "required" do HTML.
    const notaFaltando = campos.find((c) => c.tipo === "nota" && c.obrigatorio && !dados[c.chave]);
    if (notaFaltando) {
      setMensagemErro(`Escolha uma nota para "${notaFaltando.rotulo}".`);
      setFase("erro");
      return;
    }
    const decisaoFaltando = campos.find((c) => c.tipo === "decisao" && c.obrigatorio && !dados[c.chave]);
    if (decisaoFaltando) {
      setMensagemErro(`Escolha uma opção para "${decisaoFaltando.rotulo}".`);
      setFase("erro");
      return;
    }
    const escalaFaltando = campos.find((c) => c.tipo === "escala" && c.obrigatorio && !dados[c.chave]);
    if (escalaFaltando) {
      setMensagemErro(`Escolha um valor para "${escalaFaltando.rotulo}".`);
      setFase("erro");
      return;
    }
    const escolhaFaltando = campos.find((c) => c.tipo === "escolha" && c.obrigatorio && !dados[c.chave]);
    if (escolhaFaltando) {
      setMensagemErro(`Escolha uma opção para "${escolhaFaltando.rotulo}".`);
      setFase("erro");
      return;
    }
    setFase("enviando");
    try {
      const r = await fetch(`/api/f/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dados, armadilha }) });
      const resposta = await r.json();
      if (!r.ok) throw new Error(resposta.error || "Não foi possível enviar sua resposta.");
      setFase("enviado");
    } catch (err) {
      setMensagemErro(err instanceof Error ? err.message : "Erro inesperado.");
      setFase("erro");
    }
  }

  return (
    <div className="max-w-[560px] mx-auto px-8 py-12 max-md:px-4 max-md:py-8" style={{ colorScheme: "light" }}>
      <div className="flex items-center gap-3 mb-7">
        <div className="shrink-0 w-[34px] h-[34px] rounded-[9px] bg-accent text-white grid place-items-center font-extrabold text-[15px] tracking-tight">{marca}</div>
        <div className="font-bold text-[15px]">{nome}</div>
      </div>

      {fase === "enviado" ? (
        <div className="card p-7 max-md:p-[22px] text-center">
          <h1 className="text-xl font-extrabold mb-1.5">{agradecimento || "Obrigado, sua resposta foi enviada."}</h1>
          <p className="text-muted">Você já pode fechar esta página.</p>
        </div>
      ) : (
        <div className="card p-7 max-md:p-[22px]">
          <h1 className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.02em] mb-2">{titulo}</h1>
          {descricao && <p className="text-muted mb-6">{descricao}</p>}

          <form onSubmit={onSubmit}>
            {/* Honeypot: campo invisível para pessoas, atrativo para bots que preenchem tudo. */}
            <label className="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
              Deixe este campo em branco
              <input tabIndex={-1} autoComplete="off" value={armadilha} onChange={(e) => setArmadilha(e.target.value)} />
            </label>

            {campos.map((campo, i) => (
              <div key={campo.chave}>
                {campo.secao && campo.secao !== campos[i - 1]?.secao && <h2 className="text-[15px] font-bold mt-6 mb-3 first:mt-0">{campo.secao}</h2>}
                <div className="flex flex-col gap-1.5 mb-4">
                  <label htmlFor={campo.chave} className="text-[13px] font-semibold">
                    {campo.rotulo}
                    {!campo.obrigatorio && " (opcional)"}
                  </label>
                  {campo.tipo === "arquivo" ? (
                    <>
                      <input
                        id={campo.chave}
                        type="file"
                        className="input"
                        accept={campo.aceitar}
                        required={campo.obrigatorio}
                        onChange={(e) => setArquivo(campo.chave, e.target.files?.[0] ?? null)}
                      />
                      {nomesArquivo[campo.chave] && <p className="text-muted text-[12.5px]">Arquivo selecionado: {nomesArquivo[campo.chave]}</p>}
                    </>
                  ) : campo.tipo === "textarea" ? (
                    <textarea id={campo.chave} className="input min-h-24 resize-y" required={campo.obrigatorio} maxLength={4000} value={dados[campo.chave]} onChange={set(campo.chave)} />
                  ) : campo.tipo === "nota" ? (
                    <div id={campo.chave} className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={campo.rotulo}>
                      {Array.from({ length: 11 }, (_, n) => n).map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={dados[campo.chave] === String(n)}
                          className={`h-9 w-9 rounded-[10px] border text-sm font-bold transition-colors ${
                            dados[campo.chave] === String(n) ? "bg-accent border-accent text-white" : "border-line bg-white text-ink hover:bg-bg"
                          }`}
                          onClick={() => setDados((d) => ({ ...d, [campo.chave]: String(n) }))}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : campo.tipo === "decisao" ? (
                    <div id={campo.chave} className="flex flex-wrap gap-2" role="radiogroup" aria-label={campo.rotulo}>
                      {(
                        [
                          { valor: "aprovar", rotulo: "Aprovar" },
                          { valor: "ajustar", rotulo: "Pedir ajuste" },
                          { valor: "descartar", rotulo: "Descartar" },
                        ] as const
                      ).map((opcao) => (
                        <button
                          key={opcao.valor}
                          type="button"
                          role="radio"
                          aria-checked={dados[campo.chave] === opcao.valor}
                          className={`px-3.5 py-2 rounded-[10px] border text-sm font-semibold transition-colors ${
                            dados[campo.chave] === opcao.valor ? "bg-accent border-accent text-white" : "border-line bg-white text-ink hover:bg-bg"
                          }`}
                          onClick={() => setDados((d) => ({ ...d, [campo.chave]: opcao.valor }))}
                        >
                          {opcao.rotulo}
                        </button>
                      ))}
                    </div>
                  ) : campo.tipo === "escala" ? (
                    <div id={campo.chave}>
                      <div className="flex gap-1.5" role="radiogroup" aria-label={campo.rotulo}>
                        {Array.from({ length: (campo.max ?? 5) - (campo.min ?? 1) + 1 }, (_, n) => (campo.min ?? 1) + n).map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={dados[campo.chave] === String(n)}
                            className={`flex-1 h-9 rounded-[10px] border text-sm font-bold transition-colors ${
                              dados[campo.chave] === String(n) ? "bg-accent border-accent text-white" : "border-line bg-white text-ink hover:bg-bg"
                            }`}
                            onClick={() => setDados((d) => ({ ...d, [campo.chave]: String(n) }))}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      {(campo.rotuloMin || campo.rotuloMax) && (
                        <div className="flex justify-between mt-1 text-[12px] text-muted">
                          <span>{campo.rotuloMin}</span>
                          <span>{campo.rotuloMax}</span>
                        </div>
                      )}
                    </div>
                  ) : campo.tipo === "escolha" ? (
                    campo.multipla ? (
                      <div id={campo.chave} className="flex flex-col gap-2">
                        {(campo.opcoes ?? []).map((opcao) => {
                          const selecionados = dados[campo.chave] ? dados[campo.chave].split(",") : [];
                          return (
                            <label key={opcao.valor} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={selecionados.includes(opcao.valor)}
                                onChange={(e) => {
                                  const atual = dados[campo.chave] ? dados[campo.chave].split(",") : [];
                                  const novo = e.target.checked ? [...atual, opcao.valor] : atual.filter((v) => v !== opcao.valor);
                                  setDados((d) => ({ ...d, [campo.chave]: novo.join(",") }));
                                }}
                              />
                              {opcao.rotulo}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div id={campo.chave} className="flex flex-wrap gap-2" role="radiogroup" aria-label={campo.rotulo}>
                        {(campo.opcoes ?? []).map((opcao) => (
                          <button
                            key={opcao.valor}
                            type="button"
                            role="radio"
                            aria-checked={dados[campo.chave] === opcao.valor}
                            className={`px-3.5 py-2 rounded-[10px] border text-sm font-semibold transition-colors ${
                              dados[campo.chave] === opcao.valor ? "bg-accent border-accent text-white" : "border-line bg-white text-ink hover:bg-bg"
                            }`}
                            onClick={() => setDados((d) => ({ ...d, [campo.chave]: opcao.valor }))}
                          >
                            {opcao.rotulo}
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <input id={campo.chave} className="input" required={campo.obrigatorio} maxLength={4000} value={dados[campo.chave]} onChange={set(campo.chave)} />
                  )}
                </div>
              </div>
            ))}

            {fase === "erro" && <p className="text-danger text-sm mb-4">{mensagemErro}</p>}

            <button type="submit" className="btn-primary" disabled={fase === "enviando"}>
              {fase === "enviando" ? "Enviando" : "Enviar"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
