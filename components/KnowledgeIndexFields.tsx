"use client";
import { KnowledgePostgresFields } from "./KnowledgePostgresFields";
import { KnowledgeRetrievalFields } from "./KnowledgeRetrievalFields";
import type { IndexConfig } from "@/lib/knowledge-types";
import {
  EMBEDDING_PROVIDERS,
  VECTOR_PROVIDERS,
  RECORD_PROVIDERS,
  SQL_VECTOR_PROVIDERS,
  VECTOR_OPTIONS,
  embeddingDimensions,
} from "@/lib/knowledge-providers";
import { KnowledgeEmbeddingCredential } from "./KnowledgeEmbeddingCredential";
import { KnowledgeProviderSelect } from "./KnowledgeProviderSelect";
import { supabaseSetupSql } from "@/lib/knowledge-supabase-setup";
export function KnowledgeIndexFields({
  step,
  config,
  onChange,
  storage,
}: {
  step: number;
  config: IndexConfig;
  storage?: { provider: string; location: string };
  onChange: (config: IndexConfig) => void;
}) {
  const embedding = config.embeddings,
    vector = config.vectorStore,
    record = config.recordManager;
  const models =
    EMBEDDING_PROVIDERS.find((p) => p.id === embedding.provider)?.models || [];
  const embeddingChange = (values: Partial<IndexConfig["embeddings"]>) =>
    onChange({ ...config, embeddings: { ...embedding, ...values } });
  const vectorChange = (values: Partial<IndexConfig["vectorStore"]>) =>
    onChange({ ...config, vectorStore: { ...vector, ...values } });
  const recordChange = (values: Partial<IndexConfig["recordManager"]>) =>
    onChange({ ...config, recordManager: { ...record, ...values } });
  if (step === 1)
    return (
      <>
        <KnowledgeProviderSelect
          title="Selecionar embedding"
          value={embedding.provider}
          options={EMBEDDING_PROVIDERS}
          onChange={(id) => {
            const p = EMBEDDING_PROVIDERS.find((p) => p.id === id)!;
            onChange({
              ...config,
              embeddings: {
                provider: p.id,
                model: p.models[0].id,
                url: p.url,
                batchSize: 32,
                timeout: 120000,
              },
            });
          }}
        />
        <label>
          Modelo
          <select
            value={embedding.model}
            onChange={(e) => embeddingChange({ model: e.target.value, dimensions: undefined })}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
            {!models.some((m) => m.id === embedding.model) && (
              <option value={embedding.model}>
                {embedding.model} (configurado anteriormente)
              </option>
            )}
          </select>
          <small>
            Dimensões: {embeddingDimensions(embedding) || "definidas pelo serviço"}. Os modelos OpenAI de terceira geração permitem reduzir esse tamanho.
          </small>
        </label>
        <KnowledgeEmbeddingCredential
          key={embedding.provider}
          embedding={embedding}
          onChange={embeddingChange}
        />
        <details>
          <summary>Opções avançadas</summary>
          <label>
            Endereço do serviço
            <input
              required
              type="url"
              readOnly={!!embedding.credentialId}
              value={embedding.url}
              onChange={(e) =>
                embeddingChange({
                  url: e.target.value,
                  configured: false,
                  credentialId: undefined,
                  apiKey: "",
                })
              }
            />
            {embedding.provider === "ollama" && (
              <small>
                Instale o modelo escolhido no servidor Ollama antes de indexar.
              </small>
            )}
          </label>
          <div className="knowledge-form-grid">
            <label>
              Tamanho do lote
              <input
                type="number"
                min={1}
                max={100}
                value={embedding.batchSize || 32}
                onChange={(e) =>
                  embeddingChange({ batchSize: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Tempo limite (segundos)
              <input
                type="number"
                min={1}
                max={600}
                value={(embedding.timeout || 120000) / 1000}
                onChange={(e) =>
                  embeddingChange({ timeout: Number(e.target.value) * 1000 })
                }
              />
            </label>
          </div>
          {embedding.provider === "openai" && <div className="knowledge-form-grid">
            {["text-embedding-3-small", "text-embedding-3-large"].includes(embedding.model) && <label>Dimensões<input type="number" min={1} max={embeddingDimensions({ ...embedding, dimensions: undefined })} placeholder={String(embeddingDimensions({ ...embedding, dimensions: undefined }))} value={embedding.dimensions ?? ""} onChange={e => embeddingChange({ dimensions: e.target.value ? Number(e.target.value) : undefined })} /><small>Deixe em branco para usar o tamanho padrão. Alterar as dimensões exige reindexar.</small></label>}
            <label>Formato de retorno<select value={embedding.encodingFormat || "float"} onChange={e => embeddingChange({ encodingFormat: e.target.value as "float" | "base64" })}><option value="float">float</option><option value="base64">base64</option></select></label>
          </div>}
          <label className="knowledge-checkbox">
            <input
              type="checkbox"
              checked={!!embedding.stripNewLines}
              onChange={(e) =>
                embeddingChange({ stripNewLines: e.target.checked })
              }
            />
            Remover quebras de linha antes de gerar os vetores
          </label>
        </details>
      </>
    );
  if (step === 2)
    return (
      <>
        <KnowledgeProviderSelect
          title="Selecionar banco vetorial"
          value={vector.provider}
          options={VECTOR_PROVIDERS}
          onChange={(id) =>
            onChange({
              ...config,
              retrieval: { ...config.retrieval, topK: config.retrieval?.topK ?? 4, minScore: config.retrieval?.minScore ?? 0, metadataFilter: {}, distanceStrategy: "cosine" },
              vectorStore: {
                provider: id as IndexConfig["vectorStore"]["provider"],
                url: "",
                options: {},
              },
            })
          }
        />
        {vector.provider === "postgres" ? <KnowledgePostgresFields value={vector} configured={vector.connectionConfigured} onChange={vectorChange} /> : SQL_VECTOR_PROVIDERS.includes(vector.provider) ? (
          <label>
            String de conexão
            <input
              type="password"
              autoComplete="new-password"
              required={!vector.connectionConfigured}
              value={vector.connectionString || ""}
              placeholder={
                vector.connectionConfigured
                  ? "Conexão salva · preencha para substituir"
                  : vector.provider === "mongodb"
                    ? "mongodb+srv://usuario:senha@cluster/banco"
                    : vector.provider === "singlestore"
                      ? "mysql://usuario:senha@servidor:3306/banco"
                      : "postgresql://usuario:senha@servidor:5432/banco?sslmode=require"
              }
              onChange={(e) =>
                vectorChange({ connectionString: e.target.value })
              }
            />
            <small>A conexão é armazenada de forma cifrada.</small>
          </label>
        ) : (
          !["local", "faiss"].includes(vector.provider) && (
            <>
              <label>
                {vector.provider === "pinecone"
                  ? "Endereço do índice Pinecone"
                  : "Endereço do serviço"}
                <input
                  type="url"
                  required
                  value={vector.url}
                  onChange={(e) =>
                    vectorChange({
                      url: e.target.value,
                      configured: false,
                      apiKey: "",
                    })
                  }
                  placeholder={
                    vector.provider === "pinecone"
                      ? "https://seu-indice.svc.regiao.pinecone.io"
                      : "https://seu-servidor"
                  }
                />
              </label>
              <label>
                {["elasticsearch", "opensearch"].includes(vector.provider)
                  ? "Chave de API ou senha"
                  : "Chave de acesso"}
                {!["pinecone", "supabase"].includes(vector.provider)
                  ? " (opcional)"
                  : ""}
                <input
                  type="password"
                  autoComplete="new-password"
                  required={
                    ["pinecone", "supabase"].includes(vector.provider) &&
                    !vector.configured
                  }
                  value={vector.apiKey || ""}
                  placeholder={
                    vector.configured
                      ? "Credencial salva · preencha para substituir"
                      : "Chave do serviço"
                  }
                  onChange={(e) => vectorChange({ apiKey: e.target.value })}
                />
              </label>
            </>
          )
        )}
        {(VECTOR_OPTIONS[vector.provider] || []).map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              type={field.key === "batchSize" ? "number" : "text"}
              min={field.key === "batchSize" ? 1 : undefined}
              max={field.key === "batchSize" ? 1000 : undefined}
              value={vector.options?.[field.key] || ""}
              placeholder={field.placeholder}
              onChange={(e) =>
                vectorChange({
                  options: { ...vector.options, [field.key]: e.target.value },
                })
              }
            />
            {vector.provider === "postgres" && field.key === "tableName" && <small>Até 22 caracteres. Acrescentamos um identificador por base e versão para impedir sobreposição.</small>}
          </label>
        ))}
        {vector.provider === "postgres" && storage?.provider === "postgres" && <label>Tabela da versão publicada<input readOnly value={storage.location} /><small>O prefixo recebe um sufixo automático para isolar bases e versões.</small></label>}
        <KnowledgeRetrievalFields config={config} onChange={retrieval => onChange({ ...config, retrieval })} />
        <p className="knowledge-note">
          {vector.provider === "faiss" || vector.provider === "local"
            ? "O índice fica no volume persistente desta instalação."
            : vector.provider === "pinecone"
              ? "Use um índice existente com métrica cosine e tamanho compatível com o modelo escolhido. Cada versão da base usa um namespace isolado."
              : vector.provider === "supabase"
                ? "Prepare a tabela e a função de busca no SQL Editor do seu projeto usando a configuração abaixo. Use uma chave com permissão de leitura e escrita nesta tabela."
                : "Cada versão da base recebe uma coleção ou tabela isolada. O app disponibiliza a nova versão após a indexação e remove a anterior."}
        </p>
        {vector.provider === "postgres" && (
          <small>
            Requer a extensão pgvector e permissão para criar tabelas no schema
            escolhido.
          </small>
        )}
        {vector.provider === "mongodb" && (
          <small>
            Requer Atlas Vector Search e permissão para criar índices de busca.
          </small>
        )}
        {vector.provider === "supabase" && (
          <details>
            <summary>Preparar tabela e busca no Supabase</summary>
            {embeddingDimensions(embedding) ? (
              <pre className="knowledge-setup-sql">
                {supabaseSetupSql(
                  embeddingDimensions(embedding)!,
                  vector.options,
                )}
              </pre>
            ) : (
              <p>
                Escolha um modelo da lista de embeddings para gerar a
                configuração de preparação.
              </p>
            )}
          </details>
        )}
      </>
    );
  return (
    <>
      <KnowledgeProviderSelect
        title="Selecionar Record Manager"
        value={record.provider}
        options={RECORD_PROVIDERS}
        onChange={(id) =>
          onChange({
            ...config,
            recordManager: {
              provider: id as "sqlite" | "postgres",
              cleanup: record.cleanup ?? "full",
              sourceIdKey: record.sourceIdKey,
              namespace: "agentflows",
              tableName: "agentflows_records",
            },
          })
        }
      />
      {record.provider === "postgres" && (
        <>
          <KnowledgePostgresFields value={record} configured={record.configured} onChange={recordChange} />
          <label>
            Tabela
            <input
              value={record.tableName || "agentflows_records"}
              onChange={(e) => recordChange({ tableName: e.target.value })}
            />
          </label>
          <label>
            Namespace
            <input
              value={record.namespace || "agentflows"}
              onChange={(e) => recordChange({ namespace: e.target.value })}
            />
          </label>
        </>
      )}
      {record.provider !== "none" && (
        <>
        <label>
          Tipo de limpeza
          <select value={record.cleanup ?? "full"} onChange={e => recordChange({ cleanup: e.target.value as "none" | "incremental" | "full" })}>
            <option value="none">Nenhuma</option>
            <option value="incremental">Incremental</option>
            <option value="full">Completa</option>
          </select>
          <small>
            {record.cleanup === "none"
              ? "Mantém o conteúdo anterior e adiciona as novas versões. Trechos antigos continuam disponíveis nas consultas."
              : record.cleanup === "incremental"
                ? "Substitui os trechos das fontes presentes nesta indexação. Fontes ausentes são preservadas no índice."
                : "Sincroniza o índice com todos os trechos atuais da base, removendo versões antigas e conteúdo ausente."}
          </small>
        </label>
        {record.cleanup === "incremental" && <details>
          <summary>Opções avançadas</summary>
          <label>
            Chave de identificação da fonte
            <input value={record.sourceIdKey || ""} maxLength={200} placeholder="Automática" onChange={e => recordChange({ sourceIdKey: e.target.value })} />
            <small>Deixe em branco para usar a fonte cadastrada. Para distinguir documentos da mesma fonte, informe uma chave presente nos metadados de todos os trechos, como source. O valor deve ser um texto ou número estável.</small>
          </label>
        </details>}
        <div className="knowledge-choice-note">
          <div>
            <strong>Atualizações sem trabalho repetido</strong>
            <p>
              Trechos iguais reutilizam os vetores já gerados. Alterações de
              conteúdo, modelo ou preparação do texto geram novos vetores.
            </p>
            <p>
              A limpeza escolhida é aplicada ao reindexar. Excluir uma fonte
              pelo botão de exclusão sempre remove seus trechos do índice,
              independentemente deste modo. As bases são isoladas automaticamente.
            </p>
          </div>
        </div>
        </>
      )}
    </>
  );
}
