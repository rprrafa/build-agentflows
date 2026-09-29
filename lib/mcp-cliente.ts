// Cliente MCP genérico (JSON-RPC 2.0 sobre Streamable HTTP) para este app conectar a um
// servidor MCP de outro app da suíte (ex.: o "Quadro de tarefas" exposto por agente-kanban)
// ou de qualquer serviço externo compatível. Espelha o protocolo implementado em lib/mcp.ts
// (o lado servidor), só que do lado de quem chama. Compartilhado: copie sem alterar para os 10 apps.

export type ConexaoMCP = { url: string; token?: string };
export type FerramentaMCP = { nome: string; descricao?: string; schema?: unknown };

async function chamarRpc(conexao: ConexaoMCP, method: string, params?: Record<string, unknown>): Promise<unknown> {
  const cabecalhos: Record<string, string> = { "Content-Type": "application/json" };
  if (conexao.token) cabecalhos.Authorization = `Bearer ${conexao.token}`;
  let r: Response;
  try {
    r = await fetch(conexao.url, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }),
    });
  } catch (err) {
    console.error("Não foi possível conectar ao serviço MCP:", err);
    throw new Error("Não foi possível falar com o serviço. Confira o endereço e tente de novo.");
  }
  const texto = await r.text();
  let corpo: { result?: unknown; error?: { message: string } } | null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = null;
  }
  if (!corpo) {
    console.error("O serviço MCP respondeu fora do formato esperado:", r.status, texto.slice(0, 200));
    throw new Error("O serviço não respondeu no formato esperado. Confira o endereço e tente de novo.");
  }
  if (corpo.error) {
    console.error("O serviço MCP recusou a chamada:", corpo.error.message);
    throw new Error("O serviço recusou a chamada. Confira o endereço e o código de acesso.");
  }
  if (!r.ok) {
    console.error("O serviço MCP respondeu com falha:", r.status, texto.slice(0, 200));
    throw new Error("O serviço não respondeu corretamente. Confira o endereço e o código de acesso.");
  }
  return corpo.result;
}

/** Guarda o endereço e o código de acesso de um servidor MCP externo para as chamadas seguintes. */
export function conectar(url: string, token?: string): ConexaoMCP {
  return { url, token };
}

export async function listarFerramentas(conexao: ConexaoMCP): Promise<FerramentaMCP[]> {
  const resultado = (await chamarRpc(conexao, "tools/list")) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] };
  return (resultado.tools ?? []).map((t) => ({ nome: t.name, descricao: t.description, schema: t.inputSchema }));
}

export async function chamar(conexao: ConexaoMCP, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const resultado = (await chamarRpc(conexao, "tools/call", { name: nome, arguments: args })) as { content?: { type: string; text?: string }[] };
  const texto = resultado.content?.find((c) => c.type === "text")?.text;
  if (texto === undefined) return resultado;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}
