// SQL de preparação apresentado ao administrador; nunca executado com a chave REST.
export function supabaseSetupSql(
  dimensions: number,
  options: Record<string, string> = {},
) {
  const safe = (v: string, fallback: string) =>
    /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(v) ? v : fallback;
  const table = safe(options.tableName || "", "agentflows_documents"),
    query = safe(options.queryName || "", "match_agentflows_documents");
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65536)
    throw new Error("Tamanho de vetor inválido.");
  return `create extension if not exists vector;
create table if not exists public."${table}" (
  id text primary key,
  content text,
  metadata jsonb not null default '{}',
  embedding vector(${dimensions})
);
alter table public."${table}" enable row level security;
create or replace function public."${query}"(
  query_embedding vector(${dimensions}), match_count int, filter jsonb default '{}'
) returns table(id text, content text, metadata jsonb, similarity float)
language sql stable security invoker as $$
  select id, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from public."${table}"
  where metadata @> filter
  order by embedding <=> query_embedding
  limit least(match_count, 20);
$$;`;
}
