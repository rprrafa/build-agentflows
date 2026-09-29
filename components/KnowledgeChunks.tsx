"use client";
import { useCallback, useEffect, useState } from "react";
import type { Chunk, KnowledgeSource } from "@/lib/knowledge-types";
import { Icon, IconButton, Modal, request } from "./StudioUI";
export function KnowledgeChunks({
  baseId,
  source,
  disabled,
  onChanged,
}: {
  baseId: string;
  source: KnowledgeSource;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [chunks, setChunks] = useState<Chunk[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<Chunk | null>(null),
    [text, setText] = useState(""),
    [metadata, setMetadata] = useState(""),
    [toDelete, setToDelete] = useState<Chunk | null>(null),
    [busy, setBusy] = useState(false);
  const sourceUrl = `/api/knowledge/${baseId}/sources/${source.id}`;
  const load = useCallback(async () => {
    const data = await request<{ chunks: Chunk[]; total: number }>(
      `${sourceUrl}?page=${page}&search=${encodeURIComponent(search)}`,
    );
    setChunks(data.chunks);
    setTotal(data.total);
    setError("");
  }, [sourceUrl, page, search]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void request<{ chunks: Chunk[]; total: number }>(
        `${sourceUrl}?page=${page}&search=${encodeURIComponent(search)}`,
      )
        .then((data) => {
          if (active) {
            setChunks(data.chunks);
            setTotal(data.total);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sourceUrl, page, search, source.updatedAt]);
  async function mutate(chunk: Chunk, remove = false) {
    setBusy(true);
    setError("");
    try {
      let parsed: unknown = {};
      if (!remove) {
        try {
          parsed = JSON.parse(metadata);
        } catch {
          throw new Error("Informe metadados JSON válidos.");
        }
      }
      await request(
        `/api/knowledge/${baseId}/chunks/${chunk.id}`,
        remove ? "DELETE" : "PUT",
        remove ? undefined : { pageContent: text, metadata: parsed },
      );
      setEdit(null);
      setToDelete(null);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="knowledge-chunks">
      <div className="knowledge-section-title">
        <div>
          <p>
            {source.name} · {total} trecho(s)
          </p>
        </div>
      </div>
      <label className="studio-search">
        <Icon name="search" size={18} />
        <input
          aria-label="Buscar nos fragmentos"
          placeholder="Buscar conteúdo ou metadados"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {error && !edit && !toDelete && (
        <div className="studio-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">Carregando fragmentos…</p>
      ) : !chunks.length ? (
        <p>Nenhum fragmento encontrado.</p>
      ) : (
        <div className="knowledge-chunk-grid">
          {chunks.map((chunk) => (
            <article key={chunk.id}>
              <div className="knowledge-section-title">
                <span>
                  Trecho {chunk.ordinal} · {chunk.pageContent.length} caracteres
                </span>
                <div className="studio-actions">
                  <IconButton
                    icon="pencil"
                    label={`Editar trecho ${chunk.ordinal}`}
                    disabled={disabled}
                    onClick={() => {
                      setEdit(chunk);
                      setText(chunk.pageContent);
                      setMetadata(JSON.stringify(chunk.metadata, null, 2));
                      setError("");
                    }}
                  />
                  <IconButton
                    icon="trash"
                    label={`Excluir trecho ${chunk.ordinal}`}
                    disabled={disabled}
                    onClick={() => {
                      setToDelete(chunk);
                      setError("");
                    }}
                  />
                </div>
              </div>
              <pre>{chunk.pageContent}</pre>
              <details>
                <summary>Metadados</summary>
                <pre>{JSON.stringify(chunk.metadata, null, 2)}</pre>
              </details>
            </article>
          ))}
        </div>
      )}
      {total > 20 && (
        <div className="knowledge-pagination">
          <button
            className="studio-button"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} de {Math.ceil(total / 20)}
          </span>
          <button
            className="studio-button"
            disabled={page * 20 >= total || loading}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      {edit && (
        <Modal
          title={`Editar trecho ${edit.ordinal}`}
          wide
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          <form
            className="knowledge-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(edit);
            }}
          >
            <label>
              Conteúdo
              <textarea
                autoFocus
                rows={10}
                required
                maxLength={8000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label>
              Metadados
              <textarea
                rows={4}
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                spellCheck={false}
              />
            </label>
            <small>
              A alteração ficará disponível no Agente após reindexar a base.
            </small>
            {error && (
              <p className="studio-error" role="alert">
                {error}
              </p>
            )}
            <div className="knowledge-form-actions">
              <button disabled={busy} className="studio-button primary">
                {busy ? "Salvando…" : "Salvar fragmento"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toDelete && (
        <Modal
          title="Excluir fragmento?"
          onClose={() => {
            if (!busy) setToDelete(null);
          }}
        >
          <p>
            O trecho {toDelete.ordinal} será removido desta base. Reindexe
            depois para atualizar as consultas.
          </p>
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
          <div className="knowledge-form-actions">
            <button
              className="studio-button"
              disabled={busy}
              onClick={() => setToDelete(null)}
            >
              Cancelar
            </button>
            <button
              className="studio-button"
              disabled={busy}
              onClick={() => void mutate(toDelete, true)}
            >
              Excluir fragmento
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
