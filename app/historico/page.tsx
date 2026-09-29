"use client";
import { useEffect, useState } from "react";
import type { Run, RunPage } from "@/lib/flow-types";
import { isRunPage, parseRunPage } from "@/lib/run-page";
import { Icon, Modal, StudioShell } from "@/components/StudioUI";
import { RunView, RUN_STATUS } from "@/components/RunView";
import { ChatGPTConnection, useChatGPT } from "@/components/ChatGPTConnection";
export default function Page() {
  const [data, setData] = useState<RunPage | null>(null);
  // Fast Refresh can retain state from the previous, unpaginated version.
  const runPage = isRunPage(data) ? data : null;
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20);
  const [selectedId, setSelectedId] = useState(""),
    [selected, setSelected] = useState<Run | null>(null);
  const [error, setError] = useState(""),
    [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true),
    [filter, setFilter] = useState("all"),
    [connect, setConnect] = useState(false),
    [revision, setRevision] = useState(0);
  const { connection, setConnection } = useChatGPT();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/runs?page=${page}&pageSize=${pageSize}&status=${filter}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            typeof result?.error === "string" ? result.error : "Não foi possível carregar as execuções.",
          );
        const nextPage = parseRunPage(result);
        if (!controller.signal.aborted) {
          setData(nextPage);
          setPage(nextPage.page);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setData(null);
          setError((e as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, 3000);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [page, pageSize, filter, revision]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/runs/${selectedId}`, {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Não foi possível carregar esta execução.",
          );
        if (!controller.signal.aborted) {
          setSelected(result);
          setDetailError("");
          if (["running", "waiting"].includes(result.status))
            timer = setTimeout(load, 3000);
        }
      } catch (e) {
        if (!controller.signal.aborted) setDetailError((e as Error).message);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedId, revision]);
  function changePage(next: number) {
    setLoading(true);
    setPage(next);
  }
  return (
    <StudioShell
      active="runs"
      onConnect={() => setConnect(true)}
      connected={!!connection?.account}
    >
      <main className="library-page">
        <header className="library-header">
          <div>
            <div className="studio-breadcrumb">Workspace / Execuções</div>
            <h1>Execuções</h1>
            <p>Respostas, decisões e cada etapa dos seus fluxos agênticos.</p>
          </div>
          <label className="execution-filter">
            Status
            <select
              aria-label="Filtrar execuções"
              value={filter}
              onChange={(e) => {
                setLoading(true);
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todos</option>
              {Object.entries(RUN_STATUS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </header>
        {error && (
          <p role="alert" className="studio-error">
            {error}
          </p>
        )}
        {loading ? (
          <div className="library-loading">
            <span className="studio-spinner" />
            Carregando execuções…
          </div>
        ) : !runPage ? null : !runPage.items.length ? (
          <div className="library-empty">
            <Icon name="runs" size={42} />
            <h2>Nenhuma execução encontrada</h2>
            <p>Teste um fluxo para ver o resultado e o caminho percorrido.</p>
          </div>
        ) : (
          <div className="executions-table">
            <div className="execution-row table-heading">
              <span>Fluxo Agêntico / entrada</span>
              <span>Status</span>
              <span>Modo</span>
              <span>Data</span>
            </div>
            {runPage.items.map((r) => (
              <button
                className="execution-row"
                key={r.id}
                onClick={() => {
                  setSelected(null);
                  setDetailError("");
                  setSelectedId(r.id);
                }}
              >
                <span>
                  <strong>{r.name}</strong>
                  <small>{r.input}</small>
                </span>
                <span className={`execution-status ${r.status}`}>
                  {RUN_STATUS[r.status]}
                </span>
                <span>{r.demo ? "Demonstração" : "ChatGPT"}</span>
                <span>{new Date(r.createdAt).toLocaleString("pt-BR")}</span>
              </button>
            ))}
          </div>
        )}
        {runPage && <nav
          className="execution-pagination"
          aria-label="Paginação de execuções"
        >
          <label>
            Por página
            <select
              aria-label="Execuções por página"
              value={pageSize}
              onChange={(e) => {
                setLoading(true);
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span aria-live="polite">
            {runPage.total
              ? `${(runPage.page - 1) * runPage.pageSize + 1}–${Math.min(runPage.page * runPage.pageSize, runPage.total)} de ${runPage.total}`
              : "0 execuções"}
          </span>
          <div className="studio-actions">
            <button
              className="studio-button"
              disabled={loading || page <= 1}
              onClick={() => changePage(page - 1)}
            >
              Anterior
            </button>
            <span>
              Página {runPage.page} de {runPage.totalPages}
            </span>
            <button
              className="studio-button"
              disabled={loading || page >= runPage.totalPages}
              onClick={() => changePage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </nav>}
      </main>
      {selectedId && (
        <Modal
          title="Detalhes da execução"
          wide
          onClose={() => {
            setSelectedId("");
            setSelected(null);
          }}
        >
          {detailError ? (
            <>
              <p className="studio-error" role="alert">
                {detailError}
              </p>
              <button
                className="studio-button"
                onClick={() => setRevision((r) => r + 1)}
              >
                Tentar novamente
              </button>
            </>
          ) : !selected ? (
            <p role="status">Carregando detalhes…</p>
          ) : (
            <>
              <div className="test-user-message">{selected.input}</div>
              <RunView
                run={selected}
                onChange={(run) => {
                  setSelected(run);
                  setRevision((r) => r + 1);
                }}
              />
            </>
          )}
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
