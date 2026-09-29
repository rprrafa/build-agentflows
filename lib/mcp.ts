// Implementação própria do protocolo MCP (JSON-RPC 2.0 sobre Streamable HTTP) para app/mcp/route.ts.
// Decisão (ver README): implementação própria em vez de @modelcontextprotocol/sdk, porque o app só
// precisa de "tools/list" e "tools/call" (sem resources, prompts ou streaming de progresso) — a
// mesma filosofia de lib/store.ts (SQLite sem dependências) evitando uma dependência pesada para pouco uso.
import crypto from "node:crypto";
import { getConfig, mascarar, setConfig } from "./store";

export type Ferramenta = {
  nome: string;
  descricao: string;
  schema: Record<string, unknown>;
  executar: (args: Record<string, unknown>) => Promise<unknown>;
};

type RpcRequisicao = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type RpcResposta = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const CHAVE_CODIGO = "MCP_CODIGO_ACESSO";
const LIMITE_CHAMADAS = 60;
const JANELA_MS = 60_000;
const contadores = new Map<string, { inicio: number; contagem: number }>();

export function codigoAtivo(): string | undefined {
  return getConfig(CHAVE_CODIGO);
}

export function codigoMascarado(): string | null {
  return mascarar(codigoAtivo());
}

/** Gera um novo código de acesso (32 bytes aleatórios) e invalida o anterior. */
export function gerarCodigo(): string {
  const codigo = crypto.randomBytes(32).toString("base64url");
  setConfig(CHAVE_CODIGO, codigo);
  contadores.clear();
  return codigo;
}

export function revogarCodigo(): void {
  setConfig(CHAVE_CODIGO, null);
  contadores.clear();
}

function compararSeguro(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Extrai o código do cabeçalho Authorization: Bearer <código>, ou null se ausente. */
export function extrairCodigo(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const recebido = auth.slice(7).trim();
  return recebido || null;
}

export function autenticar(codigoRecebido: string | null): boolean {
  const ativo = codigoAtivo();
  if (!ativo || !codigoRecebido) return false;
  return compararSeguro(codigoRecebido, ativo);
}

/** true quando o código já passou de 60 chamadas no último minuto. */
export function limiteExcedido(codigo: string): boolean {
  const agora = Date.now();
  const atual = contadores.get(codigo);
  if (!atual || agora - atual.inicio >= JANELA_MS) {
    contadores.set(codigo, { inicio: agora, contagem: 1 });
    return false;
  }
  atual.contagem += 1;
  return atual.contagem > LIMITE_CHAMADAS;
}

export async function tratarRequisicaoRpc(corpo: RpcRequisicao, ferramentas: Ferramenta[], nomeServidor: string): Promise<RpcResposta> {
  const id = corpo.id ?? null;
  const { method, params } = corpo;
  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: nomeServidor, version: "1.0.0" },
        },
      };
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: ferramentas.map((f) => ({ name: f.nome, description: f.descricao, inputSchema: f.schema })) },
      };
    }
    if (method === "tools/call") {
      const nome = params?.name as string | undefined;
      const ferramenta = ferramentas.find((f) => f.nome === nome);
      if (!ferramenta) return { jsonrpc: "2.0", id, error: { code: -32601, message: `Ferramenta desconhecida: ${nome}` } };
      const args = (params?.arguments as Record<string, unknown>) || {};
      const resultado = await ferramenta.executar(args);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(resultado) }] } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Método desconhecido: ${method}` } };
  } catch (err) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: err instanceof Error ? err.message : "Erro interno." } };
  }
}
