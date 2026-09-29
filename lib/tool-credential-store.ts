import { embeddingCredentialProvider, embeddingCredentialKey, embeddingCredentialUrl } from "./embedding-credentials";
import { knowledgeUrl } from "./knowledge-http";
import type { IndexConfig } from "./knowledge-types";
import { randomUUID } from "node:crypto";
import { abrirBanco, getConfig, setConfig, configTransaction } from "./store";
import { currentTenant, tenantId } from "./tenant-context";
import { FlowError, listFlows } from "./flow-store";
import { TOOL_CREDENTIALS, TOOL_CREDENTIAL_LABELS, type Credential } from "./tool-credentials";
import { withToolConfig } from "./tool-config-context";
import { readToolCards } from "./agent-tools";

export type SavedToolCredential = {
  id: string; name: string; provider: string; providerLabel: string;
  configured: boolean; legacy: boolean; locked: boolean; fields: Credential[];
};
type Row = { id: string; name: string; provider: string };
const TENANT_INDEX = "TOOL_CREDENTIAL_INDEX";
function tenantRows(): Row[] { return JSON.parse(getConfig(TENANT_INDEX) || "[]"); }
const secretKey = (id: string) => `TOOL_ACCOUNT_${id}`;
function db() {
  const d = abrirBanco();
  d.exec("CREATE TABLE IF NOT EXISTS tool_credentials (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL)");
  return d;
}
function schema(provider: string) {
  if (!Object.hasOwn(TOOL_CREDENTIALS, provider)) throw new FlowError("Escolha um serviço válido para a credencial.");
  return TOOL_CREDENTIALS[provider];
}
function row(id: string): Row {
  if (id.startsWith("default:")) { const provider = id.slice(8); schema(provider); return { id, provider, name: "Conexão padrão existente" }; }
  const r = tenantId() ? tenantRows().find((row) => row.id === id) : db().prepare("SELECT * FROM tool_credentials WHERE id=?").get(id) as Row | undefined;
  if (!r) throw new FlowError("Esta credencial não existe mais. Escolha outra no agente.", 404);
  return r;
}
function values(r: Row): Record<string, string> {
  if (r.id.startsWith("default:")) return Object.fromEntries(schema(r.provider).map((field) => [field.chave, getConfig(field.chave) || ""]));
  const saved = getConfig(secretKey(r.id));
  if (!saved) throw new FlowError("Não foi possível abrir esta credencial. Edite a conexão antes de usar.");
  return JSON.parse(saved);
}
function configured(provider: string, data: Record<string, string>) {
  if (provider === "google_workspace" || provider === "microsoft") {
    const p = provider === "microsoft" ? "TOOL_MICROSOFT" : "TOOL_GOOGLE";
    return !!(data[`${p}_TOKEN`] || (data[`${p}_REFRESH_TOKEN`] && data[`${p}_CLIENT_ID`]));
  }
  return schema(provider).filter((field) => !field.optional).every((field) => !!data[field.chave]?.trim());
}
function summary(r: Row): SavedToolCredential {
  let data: Record<string, string> = {};
  try { data = values(r); } catch { /* Mostra conexão pendente, sem expor dados. */ }
  return { ...r, providerLabel: TOOL_CREDENTIAL_LABELS[r.provider] || r.provider,
    configured: configured(r.provider, data), legacy: r.id.startsWith("default:"),
    locked: !tenantId() && r.id.startsWith("default:") && schema(r.provider).some((f) => !!process.env[f.chave]?.trim()),
    fields: schema(r.provider).map((field) => ({ ...field, definido: !!data[field.chave], valor: field.secret ? undefined : data[field.chave] || "" })),
  };
}
export function listToolCredentials(provider?: string): SavedToolCredential[] {
  if (provider) schema(provider);
  const rows = tenantId() ? tenantRows().sort((a, b) => a.name.localeCompare(b.name)) : db().prepare("SELECT * FROM tool_credentials ORDER BY name COLLATE NOCASE").all() as Row[];
  const defaults = Object.keys(TOOL_CREDENTIALS).filter((p) => !provider || p === provider).filter((p) => schema(p).some((f) => !!getConfig(f.chave))).map((p) => row(`default:${p}`));
  return [...defaults, ...rows.filter((r) => !provider || r.provider === provider)].map(summary);
}
export function getToolCredential(id: string) { return summary(row(id)); }
export function saveToolCredential(input: unknown, id?: string): SavedToolCredential {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new FlowError("Preencha os dados da credencial.");
  const body = input as { name?: unknown; provider?: unknown; fields?: unknown };
  const existing = id ? row(id) : undefined;
  const provider = existing?.provider || body.provider;
  if (typeof provider !== "string") throw new FlowError("Escolha o serviço da credencial.");
  const fields = schema(provider);
  if (existing && body.provider !== undefined && body.provider !== provider) throw new FlowError("O serviço de uma credencial não pode ser alterado.");
  const name = existing?.id.startsWith("default:") ? existing.name : body.name;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) throw new FlowError("Dê um nome à conexão, com até 100 caracteres.");
  if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) throw new FlowError("Preencha os campos da conexão.");
  const entries = Object.entries(body.fields);
  if (entries.some(([key, value]) => !fields.some((f) => f.chave === key) || (value !== null && (typeof value !== "string" || value.length > 12000)))) throw new FlowError("Há campos inválidos na credencial.");
  if (!tenantId() && existing?.id.startsWith("default:") && fields.some((f) => process.env[f.chave]?.trim())) throw new FlowError("Esta conexão foi definida no servidor. Crie uma nova credencial para usar outra conta.");
  let data: Record<string, string> = Object.fromEntries(fields.filter(f => f.defaultValue).map(f => [f.chave, f.defaultValue!]));
  if (existing) { try { data = values(existing); } catch { /* Permite corrigir credencial perdida. */ } }
  for (const [key, value] of entries) {
    const field = fields.find((f) => f.chave === key)!;
    if (value === null || (!field.secret && value === "")) delete data[key];
    else if (typeof value === "string" && value.trim()) data[key] = value.trim();
  }
  if (provider.startsWith("embedding_")) {
    const urlField = fields.find(f => f.chave.endsWith("_URL"))!;
    const url = data[urlField.chave];
    if (!url || url.length > 2000) throw new FlowError("Informe o endereço do serviço de embeddings.");
    knowledgeUrl(url);
    data[urlField.chave] = url.replace(/\/$/, "");
  }
  if (!configured(provider, data)) throw new FlowError("Preencha os campos obrigatórios para salvar a conexão.");
  const saved = { id: existing?.id || randomUUID(), name: name.trim(), provider };
  if (tenantId()) {
    configTransaction(() => {
      if (saved.id.startsWith("default:")) for (const field of fields) setConfig(field.chave, data[field.chave]);
      else {
        const rows = tenantRows();
        if (rows.some((r) => r.id !== saved.id && r.provider === provider && r.name.toLowerCase() === saved.name.toLowerCase())) throw new FlowError("Já existe uma conexão com esse nome neste serviço. Escolha outro nome.");
        if (!existing && rows.length >= 200) throw new FlowError("Use até 200 credenciais por conta.", 413);
        setConfig(TENANT_INDEX, JSON.stringify([...rows.filter((r) => r.id !== saved.id), saved]));
        setConfig(secretKey(saved.id), JSON.stringify(data));
      }
    });
    return summary(saved);
  }
  const d = db();
  if (!saved.id.startsWith("default:") && d.prepare("SELECT id FROM tool_credentials WHERE provider=? AND lower(name)=lower(?) AND id<>?").get(provider, saved.name, saved.id)) throw new FlowError("Já existe uma conexão com esse nome neste serviço. Escolha outro nome.");
  d.exec("SAVEPOINT tool_credential_change");
  try {
    if (saved.id.startsWith("default:")) for (const field of fields) setConfig(field.chave, data[field.chave]);
    else {
      d.prepare("INSERT INTO tool_credentials VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name").run(saved.id, saved.name, provider);
      setConfig(secretKey(saved.id), JSON.stringify(data));
    }
    d.exec("RELEASE tool_credential_change");
  } catch (error) { d.exec("ROLLBACK TO tool_credential_change"); d.exec("RELEASE tool_credential_change"); throw error; }
  return summary(saved);
}
export function deleteToolCredential(id: string) {
  const r = row(id);
  if (tenantId()) {
    const { user, config } = currentTenant();
    // This check runs under the same user lock as flow writes and config commit.
    // The route cannot return success before the guard and deletion have committed.
    configTransaction(() => {
      config.guards.push(async (sql) => {
        const knowledge = await sql.query(`SELECT 1 FROM knowledge_bases WHERE user_id=$1 AND
          (body#>>'{config,embeddings,credentialId}'=$2 OR body#>>'{config,vectorStore,postgres,credentialId}'=$2 OR body#>>'{config,recordManager,postgres,credentialId}'=$2) LIMIT 1`, [user.id, id]);
        if (knowledge.rows.length) throw new FlowError("Esta credencial está em uso por uma base de conhecimento.", 409);
        const graphs = await sql.query<{ nodes: { data: { config: Record<string, string> } }[] }>(`SELECT body#>'{graph,nodes}' AS nodes FROM flows WHERE user_id=$1
          UNION ALL SELECT body#>'{published,nodes}' AS nodes FROM flows WHERE user_id=$1 AND body#>'{published,nodes}' IS NOT NULL
          UNION ALL SELECT body#>'{graph,nodes}' AS nodes FROM runs WHERE user_id=$1 AND status IN ('running','waiting')`, [user.id]);
        if (graphs.rows.some(({ nodes }) => nodes.some((node) => readToolCards(node.data.config.tools || "", node.data.config.toolCards).some((card) => card.credentialId === id)))) throw new FlowError("Esta credencial está em uso. Troque a conexão nos agentes ou finalize as execuções antes de excluir.", 409);
      });
      if (r.id.startsWith("default:")) for (const field of schema(r.provider)) setConfig(field.chave, null);
      else { setConfig(TENANT_INDEX, JSON.stringify(tenantRows().filter((row) => row.id !== id))); setConfig(secretKey(id), null); }
    });
    return;
  }
  if (r.id.startsWith("default:") && schema(r.provider).some((f) => process.env[f.chave]?.trim())) throw new FlowError("A conexão padrão está definida no servidor e não pode ser removida aqui.");
  const database = db();
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='knowledge_bases'").get() && database.prepare("SELECT 1 FROM knowledge_bases WHERE json_extract(body,'$.config.embeddings.credentialId')=? OR json_extract(body,'$.config.vectorStore.postgres.credentialId')=? OR json_extract(body,'$.config.recordManager.postgres.credentialId')=?").get(id, id, id))
    throw new FlowError("Esta credencial está em uso por uma base de conhecimento. Troque a conexão da base antes de excluí-la.", 409);
  const used = listFlows().some((flow) => flow.graph.nodes.some((node) => readToolCards(node.data.config.tools || "", node.data.config.toolCards).some((card) => card.credentialId === id)));
  if (used) throw new FlowError("Esta credencial está em uso. Troque a conexão nos agentes antes de excluí-la.", 409);
  const active = db().prepare("SELECT body FROM flow_runs WHERE status IN ('running','waiting')").all() as { body: string }[];
  if (active.some(({ body }) => {
    const run = JSON.parse(body);
    return run.graph.nodes.some((node: { data: { config: Record<string, string> } }) => readToolCards(node.data.config.tools || "", node.data.config.toolCards).some((card) => card.credentialId === id));
  })) throw new FlowError("Há uma execução usando esta credencial. Aguarde a conclusão ou cancele a execução antes de excluir.", 409);
  const d = db();
  d.exec("SAVEPOINT tool_credential_change");
  try {
    if (r.id.startsWith("default:")) for (const field of schema(r.provider)) setConfig(field.chave, null);
    else { d.prepare("DELETE FROM tool_credentials WHERE id=?").run(id); setConfig(secretKey(id), null); }
    d.exec("RELEASE tool_credential_change");
  } catch (error) { d.exec("ROLLBACK TO tool_credential_change"); d.exec("RELEASE tool_credential_change"); throw error; }
}
export function withToolCredential<T>(id: string | undefined, provider: string | undefined, action: () => T): T {
  if (!id) return action(); // Compatibilidade com conexões já existentes.
  const r = row(id);
  if (!provider || r.provider !== provider) throw new FlowError("A credencial escolhida não pertence ao serviço desta ferramenta.");
  if (r.id.startsWith("default:")) return action();
  const data = values(r);
  const keys = new Set(schema(provider).map((f) => f.chave));
  if (provider === "google_workspace") keys.add("TOOL_GOOGLE_EXPIRES_AT");
  if (provider === "microsoft") keys.add("TOOL_MICROSOFT_EXPIRES_AT");
  return withToolConfig({ keys, values: data, save: (key, value) => {
    const latest = values(row(id));
    if (value) latest[key] = value; else delete latest[key];
    setConfig(secretKey(id), JSON.stringify(latest));
  } }, action);
}

// Apenas o servidor recebe a chave; o navegador usa o resumo sem segredos.
export function resolveEmbeddingCredential(id: string, provider: IndexConfig["embeddings"]["provider"]) {
  const r = row(id);
  if (r.provider !== embeddingCredentialProvider(provider)) throw new FlowError("A credencial não pertence ao provedor de embeddings escolhido.");
  const data = values(r);
  if (!configured(r.provider, data)) throw new FlowError("Revise a credencial do serviço de embeddings.");
  return { apiKey: data[embeddingCredentialKey(provider)] || undefined, url: data[embeddingCredentialUrl(provider)] };
}

export function resolvePostgresCredential(id: string) {
  const r = row(id);
  if (r.provider !== "knowledge_postgres" || !configured(r.provider, values(r))) throw new FlowError("Escolha uma credencial PostgreSQL válida para a base de conhecimento.");
  const data = values(r);
  return { user: data.KNOWLEDGE_POSTGRES_USER, password: data.KNOWLEDGE_POSTGRES_PASSWORD };
}
