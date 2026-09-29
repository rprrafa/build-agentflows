"use client";
import { KnowledgeIndexFields } from "./KnowledgeIndexFields";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DEFAULT_INDEX,
  KNOWLEDGE_STATUS,
  type IndexConfig,
  type IndexRun,
  type KnowledgeBase,
  type KnowledgeHit,
  type KnowledgeSource,
} from "@/lib/knowledge-types";
import { knowledgeLoader } from "@/lib/knowledge-catalog";
import { ChatGPTConnection, useChatGPT } from "./ChatGPTConnection";
import { Icon, IconButton, Modal, request, StudioShell } from "./StudioUI";
import { KnowledgeSourceDialog } from "./KnowledgeSourceDialog";
import { KnowledgeChunks } from "./KnowledgeChunks";

type Detail = {
  base: KnowledgeBase;
  sources: KnowledgeSource[];
  runs: IndexRun[];
  usages: { id: string; name: string }[];
  cleanupPending: number;
  jobs?: { id: string; kind: string; status: string; error: string | null }[];
  storage?: { provider: string; location: string };
};
const steps = [
  "Documentos",
  "Embeddings",
  "Vector Store",
  "Record Manager",
  "Testar consulta",
];
const time = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
function Status({ base }: { base: KnowledgeBase }) {
  return (
    <span className={`knowledge-status ${base.status}`}>
      {KNOWLEDGE_STATUS[base.status]}
    </span>
  );
}

export function KnowledgeWorkspace({ id }: { id?: string }) {
  const router = useRouter();
  const { connection, setConnection } = useChatGPT();
  const [connect, setConnect] = useState(false),
    [bases, setBases] = useState<KnowledgeBase[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [search, setSearch] = useState(""),
    [step, setStep] = useState(0),
    [editBase, setEditBase] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [deleteBase, setDeleteBase] = useState<KnowledgeBase | null>(null),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [sourceDialog, setSourceDialog] = useState<KnowledgeSource | "new" | null>(
      null,
    ),
    [deleteSource, setDeleteSource] = useState<KnowledgeSource | null>(null),
    [selectedSource, setSelectedSource] = useState(""),
    [extractingSource, setExtractingSource] = useState(""),
    [config, setConfig] = useState<IndexConfig>(structuredClone(DEFAULT_INDEX)),
    [configDirty, setConfigDirty] = useState(false),
    [query, setQuery] = useState(""),
    [topK, setTopK] = useState(""),
    [minScore, setMinScore] = useState(""),
    [hits, setHits] = useState<KnowledgeHit[] | null>(null),
    [history, setHistory] = useState(false);
  const configuredFor = useRef("");
  const load = useCallback(async () => {
    if (id) {
      const data = await request<Detail>(`/api/knowledge/${id}`);
      setDetail(data);
      if (configuredFor.current !== id) {
        setConfig(data.base.config);
        configuredFor.current = id;
      }
    } else setBases(await request<KnowledgeBase[]>("/api/knowledge"));
  }, [id]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void load()
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    if (
      !id ||
      (!busy &&
        !detail?.jobs?.some((job) => ["queued", "running"].includes(job.status)) &&
        detail?.base.status !== "indexing" &&
        !detail?.sources.some((source) => source.status === "processing"))
    )
      return;
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [id, busy, detail?.base.status, detail?.sources, detail?.jobs, load]);
  useEffect(() => {
    if (!configDirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [configDirty]);
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy("");
    }
  }
  async function saveBase() {
    await act("Salvando base…", async () => {
      if (id) {
        await request(`/api/knowledge/${id}`, "PUT", { name, description });
        setEditBase(false);
        setNotice("Base atualizada.");
      } else {
        const created = await request<KnowledgeBase>("/api/knowledge", "POST", {
          name,
          description,
        });
        router.push(`/knowledge/${created.id}`);
      }
    });
  }
  async function saveConfig(next = false) {
    await act("Salvando configuração…", async () => {
      const saved = await request<KnowledgeBase>(
        `/api/knowledge/${id}`,
        "PUT",
        { config },
      );
      setConfig(saved.config);
      setConfigDirty(false);
      setNotice(saved.status === "ready" ? "Configuração salva. As opções de busca já estão em uso." : "Configuração salva. Reindexe para disponibilizar alterações.");
      if (next) setStep(Math.min(step + 1, 4));
    });
  }
  function changeConfig(next: IndexConfig) {
    setConfig(next);
    setConfigDirty(true);
  }
  async function processSource(source: KnowledgeSource) {
    setExtractingSource(source.id);
    try {
      await act(`Extraindo ${source.name}…`, async () => {
        const result = await request<{
          queued?: boolean;
          warnings: string[];
          documents: number;
          chunks: number;
        }>(`/api/knowledge/${id}/sources/${source.id}`, "POST");
        setSelectedSource(source.id);
        setStep(0);
        if (result.queued) { setNotice("Extração adicionada à fila. O conteúdo será atualizado automaticamente."); return; }
        setNotice(
          `${result.documents} documento(s) extraído(s) em ${result.chunks} fragmento(s). ${result.warnings.join(" ") || "Revise o conteúdo antes de indexar."}`,
        );
      });
    } finally {
      setExtractingSource("");
    }
  }
  const base = detail?.base;
  const sources = detail?.sources || [];
  const selected = sources.find((s) => s.id === selectedSource);
  const locked =
    !!busy ||
    !!detail?.jobs?.some((job) => ["queued", "running"].includes(job.status)) ||
    base?.status === "indexing" ||
    sources.some((source) => source.status === "processing");
  const visible = bases.filter((b) =>
    (b.name + " " + b.description).toLowerCase().includes(search.toLowerCase()),
  );
  const currentRun = detail?.runs.find((r) => r.status === "running");
  return (
    <StudioShell
      active="knowledge"
      connected={!!connection?.account}
      onConnect={() => setConnect(true)}
    >
      <main className="library-page knowledge-page">
        <header className="library-header">
          <div>
            <div className="studio-breadcrumb">
              <Link href="/">Workspace</Link> /{" "}
              <Link href="/knowledge">Base de Conhecimento</Link>
              {base && " / " + base.name}
            </div>
            <h1>{base?.name || "Base de Conhecimento"}</h1>
            <p>
              {base
                ? base.description ||
                  "Prepare os documentos que seus agentes poderão consultar."
                : "Transforme documentos e fontes de dados em conhecimento para seus agentes."}
            </p>
          </div>
          <div className="studio-actions">
            {base ? (
              <>
                <button
                  className="studio-button"
                  onClick={() => setHistory(true)}
                >
                  <Icon name="history" size={18} />
                  Histórico
                </button>
                <IconButton
                  icon="settings"
                  label="Editar nome e descrição da base"
                  disabled={locked}
                  onClick={() => {
                    setName(base.name);
                    setDescription(base.description);
                    setEditBase(true);
                  }}
                />
                <IconButton
                  icon="trash"
                  label="Excluir base de conhecimento"
                  danger
                  disabled={locked}
                  onClick={() => { setDeleteConfirmation(""); setError(""); setDeleteBase(base); }}
                />
              </>
            ) : (
              !id && (
                <button
                  className="studio-button primary"
                  onClick={() => {
                    setName("");
                    setDescription("");
                    setEditBase(true);
                  }}
                >
                  <Icon name="plus" size={18} />
                  Nova base
                </button>
              )
            )}
          </div>
        </header>
        {error && !editBase && !deleteBase && !deleteSource && (
          <div className="studio-error" role="alert">
            {error}
            <button
              className="studio-button"
              onClick={() => {
                setError("");
                void load().catch((e) => setError(e.message));
              }}
            >
              Atualizar
            </button>
          </div>
        )}
        {notice && (
          <div className="knowledge-notice" role="status">
            <Icon name="check" size={18} />
            <span>{notice}</span>
            <IconButton
              icon="close"
              label="Fechar confirmação"
              onClick={() => setNotice("")}
            />
          </div>
        )}
        {detail?.jobs?.[0]?.error && (
          <div className="studio-error" role="alert">{detail.jobs[0].error}</div>
        )}
        {busy && (
          <div className="knowledge-progress" role="status">
            <span className="knowledge-spinner" />
            <span>
              {busy}
              {currentRun &&
                ` · ${currentRun.embedded + currentRun.reused} de ${currentRun.total} fragmentos`}
            </span>
          </div>
        )}
        {loading ? (
          <div className="knowledge-empty">
            <p role="status">Carregando bases…</p>
          </div>
        ) : !id ? (
          <>
            <div className="library-toolbar">
              <label className="studio-search">
                <Icon name="search" size={18} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar bases de conhecimento"
                  aria-label="Buscar bases de conhecimento"
                />
              </label>
              <span className="library-count">{visible.length} base(s)</span>
            </div>
            {!visible.length ? (
              <div className="knowledge-empty">
                <span className="knowledge-symbol large">
                  <Icon name="book" size={32} />
                </span>
                <h2>
                  {bases.length
                    ? "Nenhuma base encontrada"
                    : "O conhecimento da sua equipe, ao alcance dos agentes"}
                </h2>
                <p>
                  {bases.length
                    ? "Tente buscar por outro nome."
                    : "Adicione arquivos, páginas e serviços. Revise os fragmentos, configure a busca e conecte a base a um Agente."}
                </p>
                {!bases.length && (
                  <button
                    className="studio-button primary"
                    onClick={() => {
                      setName("");
                      setDescription("");
                      setEditBase(true);
                    }}
                  >
                    Criar primeira base
                  </button>
                )}
              </div>
            ) : (
              <div className="knowledge-base-grid">
                {visible.map((b) => (
                  <article key={b.id}>
                    <div className="knowledge-card-header">
                      <span className="knowledge-symbol">
                        <Icon name="book" size={22} />
                      </span>
                      <div className="knowledge-card-actions">
                        <Status base={b} />
                        <IconButton
                          icon="trash"
                          label={`Excluir base ${b.name}`}
                          danger
                          disabled={locked}
                          onClick={() => { setDeleteConfirmation(""); setError(""); setDeleteBase(b); }}
                        />
                      </div>
                    </div>
                    <Link href={`/knowledge/${b.id}`}>
                      <h2>{b.name}</h2>
                      <p>
                        {b.description ||
                          "Organize documentos e prepare a busca dos agentes."}
                      </p>
                      <div className="knowledge-card-stats">
                        <span>{b.sources} fonte(s)</span>
                        <span>
                          {b.chunks.toLocaleString("pt-BR")} fragmento(s)
                        </span>
                      </div>
                      <small>Atualizada em {time(b.updatedAt)}</small>
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          base && (
            <>
              <div className="knowledge-overview">
                <Status base={base} />
                <span>
                  <strong>{base.sources}</strong> fontes
                </span>
                <span>
                  <strong>{base.chunks.toLocaleString("pt-BR")}</strong>{" "}
                  fragmentos
                </span>
                <span>
                  <strong>{base.indexedChunks.toLocaleString("pt-BR")}</strong>{" "}
                  indexados
                </span>
                {base.indexedAt && (
                  <small>Última indexação: {time(base.indexedAt)}</small>
                )}
              </div>
              {base.error && <p className="studio-error">{base.error}</p>}
              {detail!.cleanupPending > 0 && (
                <div className="knowledge-note">
                  Há índices anteriores aguardando limpeza no serviço externo.{" "}
                  <button
                    className="studio-button"
                    disabled={locked}
                    onClick={() =>
                      void act("Limpando índices anteriores…", async () => {
                        const result = await request<{ pending: number }>(
                          `/api/knowledge/${id}/index`,
                          "DELETE",
                        );
                        setNotice(
                          result.pending
                            ? "O serviço ainda não permitiu a limpeza. Confira a conexão e tente novamente."
                            : "Índices anteriores removidos.",
                        );
                      })
                    }
                  >
                    Tentar limpeza novamente
                  </button>
                </div>
              )}
              <nav className="knowledge-steps" aria-label="Etapas da base">
                {steps.map((label, i) => (
                  <button
                    key={label}
                    aria-current={step === i ? "step" : undefined}
                    className={step === i ? "active" : ""}
                    onClick={() => setStep(i)}
                  >
                    <span>{i + 1}</span>
                    {label}
                  </button>
                ))}
              </nav>
              {step === 0 && (
                <>
                  <section className="knowledge-panel">
                    <div className="knowledge-section-title">
                      <div>
                        <h2>Fontes de conhecimento</h2>
                        <p>
                          Adicione conteúdo, extraia e revise os trechos que
                          serão consultados.
                        </p>
                      </div>
                      <button
                        className="studio-button primary"
                        disabled={locked}
                        onClick={() => setSourceDialog("new")}
                      >
                        <Icon name="plus" size={18} />
                        Adicionar fonte
                      </button>
                    </div>
                    {!sources.length ? (
                      <div className="knowledge-empty compact">
                        <Icon name="paperclip" size={30} />
                        <h3>Comece pelos documentos</h3>
                        <p>
                          Envie arquivos, cole um texto ou conecte uma das 20
                          opções de extração.
                        </p>
                        <button
                          className="studio-button"
                          onClick={() => setSourceDialog("new")}
                        >
                          Escolher fonte
                        </button>
                      </div>
                    ) : (
                      <div className="knowledge-source-list">
                        {sources.map((source) => (
                          <article
                            key={source.id}
                            className={
                              selectedSource === source.id ? "selected" : ""
                            }
                          >
                            <div className="knowledge-symbol">
                              <Icon
                                name={
                                  knowledgeLoader(source.loader)?.accept
                                    ? "paperclip"
                                    : "http"
                                }
                                size={21}
                              />
                            </div>
                            <div className="knowledge-source-info">
                              <strong>{source.name}</strong>
                              <small>
                                {knowledgeLoader(source.loader)?.name} ·{" "}
                                {source.chunks} fragmento(s) ·{" "}
                                {source.characters.toLocaleString("pt-BR")}{" "}
                                caracteres
                              </small>
                              <span
                                className={`knowledge-source-state ${source.status}`}
                              >
                                {source.status === "processed"
                                  ? "Conteúdo extraído"
                                  : source.status === "processing"
                                    ? "Extraindo conteúdo…"
                                    : source.status === "failed"
                                      ? source.error || "Falha na extração"
                                      : "Aguardando extração"}
                              </span>
                            </div>
                            <div className="studio-actions">
                              {source.chunks > 0 && (
                                <button
                                  className="studio-button"
                                  onClick={() => setSelectedSource(source.id)}
                                >
                                  Revisar
                                </button>
                              )}
                              <button
                                className="studio-button"
                                disabled={locked}
                                onClick={() => void processSource(source)}
                              >
                                {extractingSource === source.id ||
                                source.status === "processing" ? (
                                  <>
                                    <span
                                      className="knowledge-spinner"
                                      aria-hidden="true"
                                    />
                                    Extraindo…
                                  </>
                                ) : source.status === "processed" ? (
                                  "Reextrair"
                                ) : (
                                  "Extrair"
                                )}
                              </button>
                              <IconButton
                                icon="settings"
                                label={`Configurar ${source.name}`}
                                disabled={locked}
                                onClick={() => setSourceDialog(source)}
                              />
                              <IconButton
                                icon="trash"
                                label={`Excluir fonte ${source.name}`}
                                disabled={locked}
                                onClick={() => setDeleteSource(source)}
                              />
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    <div className="knowledge-form-actions">
                      <button
                        className="studio-button"
                        onClick={() => setStep(1)}
                      >
                        Configurar Embeddings
                        <Icon name="chevron" size={16} />
                      </button>
                    </div>
                  </section>
                  {selected && (
                    <Modal
                      title="Revisar fragmentos"
                      wide
                      className="knowledge-review-modal"
                      onClose={() => setSelectedSource("")}
                    >
                      <KnowledgeChunks
                        key={selected.id}
                        baseId={base.id}
                        source={selected}
                        disabled={locked}
                        onChanged={load}
                      />
                    </Modal>
                  )}
                </>
              )}
              {step > 0 && step < 4 && (
                <section className="knowledge-panel knowledge-config-panel">
                  <form
                    className="knowledge-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveConfig(true);
                    }}
                  >
                    <div>
                      <span className="knowledge-eyebrow">
                        Etapa {step + 1} de 5
                      </span>
                      <h2>{steps[step]}</h2>
                      <p className="knowledge-lead">
                        {step === 1
                          ? "Escolha o modelo que transforma textos em representações para a busca por significado."
                          : step === 2
                            ? "Escolha onde guardar e consultar os vetores dos documentos."
                            : "Controle o que já foi indexado e evite gerar os mesmos embeddings novamente."}
                      </p>
                    </div>
                    <KnowledgeIndexFields
                      step={step}
                      config={config}
                      storage={detail?.storage}
                      onChange={changeConfig}
                    />
                    {configDirty && (
                      <small className="knowledge-unsaved">
                        Há alterações ainda não salvas.
                      </small>
                    )}
                    <div className="knowledge-form-actions">
                      <button
                        className="studio-button"
                        type="button"
                        disabled={locked}
                        onClick={(e) => { if (e.currentTarget.form?.reportValidity()) void saveConfig(); }}
                      >
                        Salvar configuração
                      </button>
                      <button
                        className="studio-button primary"
                        disabled={locked}
                      >
                        Salvar e continuar
                        <Icon name="chevron" size={16} />
                      </button>
                    </div>
                  </form>
                </section>
              )}
              {step === 4 && (
                <section className="knowledge-panel">
                  <h2>Teste o conhecimento da base</h2>
                  <p className="knowledge-lead">
                    Veja os trechos que uma pergunta encontra antes de conectar
                    a base ao Agente.
                  </p>
                  <form
                    className="knowledge-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("Consultando a base…", async () => {
                        setHits(null);
                        setHits(
                          await request<KnowledgeHit[]>(
                            `/api/knowledge/${id}/query`,
                            "POST",
                            { query, topK: topK === "" ? undefined : Number(topK), minScore: minScore === "" ? undefined : Number(minScore) },
                          ),
                        );
                      });
                    }}
                  >
                    <label>
                      Pergunta
                      <textarea
                        rows={3}
                        required
                        maxLength={20000}
                        placeholder="Por exemplo: qual é a política de reembolso?"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <details>
                      <summary>Ajustar consulta</summary>
                      <small>Deixe em branco para usar os valores salvos na base. Filtros e estratégia de distância seguem a configuração da busca.</small>
                      <div className="knowledge-form-grid">
                        <label>
                          Top K
                          <input
                            type="number"
                            min="1"
                            max="20"
                            placeholder={`Padrão da base: ${base.config.retrieval?.topK ?? 4}`}
                            value={topK}
                            onChange={(e) => setTopK(e.target.value)}
                          />
                        </label>
                        <label>
                          Similaridade mínima
                          <input
                            type="number"
                            min="-1"
                            max="1"
                            step="0.05"
                            placeholder={`Padrão da base: ${base.config.retrieval?.minScore ?? 0}`}
                            value={minScore}
                            onChange={(e) =>
                              setMinScore(e.target.value)
                            }
                          />
                        </label>
                      </div>
                    </details>
                    <div className="knowledge-form-actions">
                      {base.status !== "ready" && (
                        <small>Conclua a indexação para testar.</small>
                      )}
                      <button
                        className="studio-button primary"
                        disabled={locked || base.status !== "ready"}
                      >
                        <Icon name="search" size={18} />
                        Consultar base
                      </button>
                    </div>
                  </form>
                  {hits && (
                    <div className="knowledge-query-results">
                      <h3>
                        {hits.length
                          ? `${hits.length} trecho(s) encontrado(s)`
                          : "Nenhum trecho encontrado"}
                      </h3>
                      {!hits.length && (
                        <p>
                          Tente reformular a pergunta ou diminuir a pontuação
                          mínima.
                        </p>
                      )}
                      {hits.map((hit) => (
                        <article key={hit.id}>
                          <div className="knowledge-section-title">
                            <strong>
                              {hit.sourceName} · trecho {hit.ordinal}
                            </strong>
                            <span>Similaridade {hit.score.toFixed(3)}</span>
                          </div>
                          <pre>{hit.pageContent}</pre>
                          <details>
                            <summary>Origem e metadados</summary>
                            <pre>{JSON.stringify(hit.metadata, null, 2)}</pre>
                          </details>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <section className="knowledge-index-bar">
                <div>
                  <strong>
                    {base.status === "ready"
                      ? "Base disponível para seus agentes"
                      : "Disponibilize o conhecimento"}
                  </strong>
                  <small>
                    {base.status === "ready"
                      ? "No bloco Agente, selecione esta base e escolha se deseja retornar as referências."
                      : "Após revisar as fontes e salvar a configuração, indexe a base para ativar a consulta."}
                  </small>
                </div>
                <button
                  className="studio-button primary"
                  disabled={
                    locked ||
                    configDirty ||
                    (base.config.embeddings.provider !== "ollama" &&
                      !base.config.embeddings.configured) ||
                    sources.some((s) => s.status !== "processed") ||
                    (!base.chunks && !base.indexedAt)
                  }
                  onClick={() =>
                    void act("Indexando a base…", async () => {
                      const result = await request<{ run: IndexRun; queued?: boolean }>(
                        `/api/knowledge/${id}/index`,
                        "POST",
                      );
                      setStep(4);
                      setHits(null);
                      if (result.queued) { setNotice("Indexação adicionada à fila. A base será atualizada automaticamente."); return; }
                      setNotice(
                        `Base disponível. ${result.run.embedded} embeddings gerados e ${result.run.reused} reaproveitados.`,
                      );
                    })
                  }
                >
                  <Icon name="play" size={18} />
                  {base.status === "indexing"
                    ? "Indexando…"
                    : base.status === "ready"
                      ? "Reindexar base"
                      : "Indexar base"}
                </button>
              </section>
              {detail!.usages.length > 0 && (
                <p className="knowledge-usages">
                  Usada em:{" "}
                  {detail!.usages.map((flow, i) => (
                    <span key={flow.id}>
                      {i > 0 && ", "}
                      <Link href={`/flows/${flow.id}`}>{flow.name}</Link>
                    </span>
                  ))}
                </p>
              )}
            </>
          )
        )}
      </main>
      {editBase && (
        <Modal
          title={id ? "Editar base" : "Nova base de conhecimento"}
          onClose={() => {
            if (!busy) setEditBase(false);
          }}
        >
          <form
            className="knowledge-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveBase();
            }}
          >
            <label>
              Nome
              <input
                autoFocus
                required
                maxLength={100}
                placeholder="Ex.: Atendimento ao cliente"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Descrição
              <textarea
                rows={3}
                maxLength={2000}
                placeholder="O que os agentes poderão consultar nesta base?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            {error && (
              <p className="studio-error" role="alert">
                {error}
              </p>
            )}
            <div className="knowledge-form-actions">
              <button
                className="studio-button"
                type="button"
                disabled={!!busy}
                onClick={() => setEditBase(false)}
              >
                Cancelar
              </button>
              <button className="studio-button primary" disabled={!!busy}>
                {id ? "Salvar alterações" : "Criar base"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleteBase && (
        <Modal
          title={`Excluir “${deleteBase.name}”?`}
          onClose={() => {
            if (!busy) setDeleteBase(null);
          }}
        >
          <p>
            Os documentos, fragmentos e vetores desta base serão excluídos,
            incluindo índices locais e versões anteriores em outros bancos.
            Esta ação não pode ser desfeita.
          </p>
          <form className="knowledge-form" onSubmit={e => {
            e.preventDefault();
            if (busy || deleteConfirmation !== deleteBase.name) return;
            void act("Excluindo base…", async () => {
              await request(`/api/knowledge/${deleteBase.id}`, "DELETE");
              setDeleteBase(null);
              setDeleteConfirmation("");
              if (id) router.push("/knowledge");
              else setNotice("Base excluída.");
            });
          }}>
          <label>
            Digite o nome da base para confirmar
            <input autoComplete="off" spellCheck={false} value={deleteConfirmation} disabled={!!busy} onChange={e => setDeleteConfirmation(e.target.value)} />
            <small>Digite exatamente: <strong>{deleteBase.name}</strong></small>
          </label>
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
          <div className="knowledge-form-actions">
            <button
              type="submit"
              className="studio-button destructive"
              disabled={!!busy || deleteConfirmation !== deleteBase.name}
            >
              <Icon name="trash" size={16} />
              {busy ? "Excluindo…" : "Excluir base"}
            </button>
          </div>
          </form>
        </Modal>
      )}
      {deleteSource && (
        <Modal
          title={`Excluir “${deleteSource.name}”?`}
          onClose={() => {
            if (!busy) setDeleteSource(null);
          }}
        >
          <p>
            A fonte e seus fragmentos serão removidos. Depois, reindexe a base
            para atualizar os vetores.
          </p>
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
          <div className="knowledge-form-actions">
            <button
              className="studio-button destructive"
              disabled={!!busy}
              onClick={() =>
                void act("Excluindo fonte…", async () => {
                  await request(
                    `/api/knowledge/${id}/sources/${deleteSource.id}`,
                    "DELETE",
                  );
                  setSelectedSource("");
                  setDeleteSource(null);
                  setNotice(
                    "Fonte removida. Reindexe a base para atualizar as consultas.",
                  );
                })
              }
            >
              <Icon name="trash" size={16} />
              {busy ? "Excluindo…" : "Excluir fonte"}
            </button>
          </div>
        </Modal>
      )}
      {sourceDialog && id && (
        <KnowledgeSourceDialog
          baseId={id}
          source={sourceDialog === "new" ? undefined : sourceDialog}
          onClose={() => setSourceDialog(null)}
          onSaved={async (source) => {
            setSourceDialog(null);
            await load();
            await processSource(source);
          }}
        />
      )}
      {history && (
        <Modal
          title="Histórico de indexação"
          wide
          onClose={() => setHistory(false)}
        >
          <div className="knowledge-history">
            {!detail?.runs.length ? (
              <p>Nenhuma indexação realizada ainda.</p>
            ) : (
              detail.runs.map((run) => (
                <article key={run.id}>
                  <div className="knowledge-section-title">
                    <strong>
                      {run.status === "completed"
                        ? "Concluída"
                        : run.status === "failed"
                          ? "Falhou"
                          : "Em andamento"}
                    </strong>
                    <small>{time(run.startedAt)}</small>
                  </div>
                  <p>
                    {run.total} fragmentos · {run.embedded} embeddings gerados ·{" "}
                    {run.reused} reaproveitados
                  </p>
                  {run.finishedAt && (
                    <small>
                      Duração:{" "}
                      {Math.max(
                        1,
                        Math.round(
                          (Date.parse(run.finishedAt) -
                            Date.parse(run.startedAt)) /
                            1000,
                        ),
                      )}{" "}
                      s
                    </small>
                  )}
                  {run.error && <p className="studio-error">{run.error}</p>}
                </article>
              ))
            )}
          </div>
        </Modal>
      )}
      {connect && (
        <ChatGPTConnection
          onClose={() => setConnect(false)}
          onChange={setConnection}
        />
      )}
    </StudioShell>
  );
}
