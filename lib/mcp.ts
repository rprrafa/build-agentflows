import crypto from "node:crypto";
import { getConfig, mascarar, setConfig } from "./store";
import { currentTenant, withTenantJob } from "./tenant-context";
import { saasDatabase } from "./saas-db";
import { AuthError, appOrigin } from "./saas-security";
import { consumeRateLimit, rateLimitClient } from "./saas-rate-limit";
import { httpError, privateJson } from "./saas-http";

export type Ferramenta = {
  nome: string;
  descricao: string;
  schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  executar: (args: Record<string, unknown>) => Promise<unknown>;
};
const CHAVE_CODIGO = "MCP_CODIGO_ACESSO";
const CODE_PATTERN = /^af_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/;

export function codigoAtivo(): string | undefined {
  currentTenant();
  return getConfig(CHAVE_CODIGO);
}
export function codigoMascarado(): string | null { return mascarar(codigoAtivo()); }
/** The owner prefix only routes authentication; it never grants access by itself. */
export function gerarCodigo(): string {
  const codigo = `af_${currentTenant().user.id}.${crypto.randomBytes(32).toString("base64url")}`;
  setConfig(CHAVE_CODIGO, codigo);
  return codigo;
}
export function revogarCodigo(): void { currentTenant(); setConfig(CHAVE_CODIGO, null); }
export function extrairCodigo(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") && auth.length <= 256 ? auth.slice(7).trim() || null : null;
}
export function autenticar(recebido: string | null): boolean {
  const ativo = codigoAtivo();
  if (!ativo || !recebido) return false;
  const a = Buffer.from(ativo), b = Buffer.from(recebido);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/** Authenticate before tools can read flows, credentials or knowledge. No cookie fallback. */
export async function integrationApi(req: Request, action: () => unknown | Promise<unknown>) {
  try {
    if (req.headers.has("origin") && req.headers.get("origin") !== appOrigin()) throw new AuthError("Origem da requisição inválida.", 403);
    const db = saasDatabase();
    await consumeRateLimit(db, `integration:ip:${rateLimitClient(req.headers)}`, 180, 60);
    const codigo = extrairCodigo(req), owner = codigo?.match(CODE_PATTERN)?.[1];
    if (!owner) throw new AuthError("Código de acesso inválido.", 401);
    return await withTenantJob(db, owner, async () => {
      if (!autenticar(codigo)) throw new AuthError("Código de acesso inválido.", 401);
      await consumeRateLimit(db, `integration:user:${owner}`, 60, 60);
      const result = await action();
      if (!(result instanceof Response)) return privateJson(result);
      const headers = new Headers(result.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(result.body, { status: result.status, headers });
    });
  } catch (error) { return httpError(error); }
}
export async function integrationExecutionLimit() {
  const { db, user } = currentTenant();
  await consumeRateLimit(db, `integration-execute:user:${user.id}`, 20, 60);
}
