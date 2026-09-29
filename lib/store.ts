// Armazenamento local de configuração em SQLite (node:sqlite, sem dependências).
// As chaves das integrações ficam aqui, gravadas pelo setup inicial (/setup), sempre
// cifradas em repouso (AES-256-GCM, node:crypto) — ver cifrar()/decifrar() abaixo.
// Variáveis de ambiente continuam funcionando como alternativa e têm prioridade.
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { forbidLegacyStorage, tenantId, currentTenant } from "./tenant-context";
import { stageConfig } from "./tenant-config-state";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
let db: DatabaseSync | null = null;

const ALGORITMO = "aes-256-gcm";
let chaveMestraCache: Buffer | null = null;

/**
 * Chave mestra da cifragem: `CHAVE_MESTRA` do ambiente (32 bytes em base64) quando
 * existir; senão, gerada uma vez e guardada em `<DATA_DIR>/chave-mestra` (permissão
 * 0600). Perder o arquivo (sem `CHAVE_MESTRA` no ambiente) torna as chaves salvas
 * ilegíveis — decifrar() trata isso devolvendo undefined, nunca derrubando o app.
 */
function chaveMestra(): Buffer {
  if (chaveMestraCache) return chaveMestraCache;
  const env = process.env.CHAVE_MESTRA?.trim();
  if (env) {
    const buf = Buffer.from(env, "base64");
    if (buf.length === 32) {
      chaveMestraCache = buf;
      return buf;
    }
    console.error("CHAVE_MESTRA inválida (precisa de 32 bytes em base64); gerando uma chave própria em DATA_DIR.");
  }
  const arquivo = path.join(DATA_DIR, "chave-mestra");
  try {
    const existente = fs.readFileSync(arquivo);
    if (existente.length === 32) {
      chaveMestraCache = existente;
      return existente;
    }
  } catch {
    // arquivo ainda não existe: gera abaixo
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const nova = crypto.randomBytes(32);
  fs.writeFileSync(arquivo, nova, { mode: 0o600 });
  chaveMestraCache = nova;
  return nova;
}

/** Formato gravado no banco: `v1:<iv>:<tag>:<cifra>`, tudo em base64url. */
function cifrar(valor: string): string {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv(ALGORITMO, chaveMestra(), iv);
  const dados = Buffer.concat([cifra.update(valor, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${dados.toString("base64url")}`;
}

/** Devolve undefined (com console.error) quando o valor não tem o formato esperado ou a chave mestra não abre mais o segredo. */
function decifrar(valorCifrado: string): string | undefined {
  const partes = valorCifrado.split(":");
  if (partes.length !== 4 || partes[0] !== "v1") return undefined;
  try {
    const [, ivB64, tagB64, dadosB64] = partes;
    const decifra = crypto.createDecipheriv(ALGORITMO, chaveMestra(), Buffer.from(ivB64, "base64url"));
    decifra.setAuthTag(Buffer.from(tagB64, "base64url"));
    const texto = Buffer.concat([decifra.update(Buffer.from(dadosB64, "base64url")), decifra.final()]);
    return texto.toString("utf8");
  } catch (err) {
    console.error("Falha ao decifrar uma configuração salva: a chave mestra mudou ou foi perdida.", err);
    return undefined;
  }
}

function abrir(): DatabaseSync {
  forbidLegacyStorage();
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "app.sqlite"));
  db.exec(`CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

/** Mesmo arquivo app.sqlite para todo o app: config, conta e sessões (lib/conta.ts). */
export function abrirBanco(): DatabaseSync {
  return abrir();
}

/** Lê uma configuração: variável de ambiente primeiro, depois o banco (cifrado). */
export function getConfig(chave: string): string | undefined {
  if (tenantId()) return currentTenant().config.values.get(chave);
  forbidLegacyStorage();
  const env = process.env[chave];
  if (env && env.trim()) return env.trim();
  try {
    const linha = abrir().prepare("SELECT valor FROM config WHERE chave = ?").get(chave) as { valor: string } | undefined;
    if (!linha?.valor) return undefined;
    if (linha.valor.startsWith("v1:")) return decifrar(linha.valor);
    // Valor antigo em texto plano (de antes da cifragem): devolve e regrava já cifrado.
    setConfig(chave, linha.valor);
    return linha.valor;
  } catch (err) {
    console.error("Falha ao ler configuração", chave, err);
    return undefined;
  }
}

export function setConfig(chave: string, valor: string | null | undefined): void {
  if (tenantId()) { stageConfig(currentTenant().config, chave, valor); return; }
  const d = abrir();
  if (valor === null || valor === undefined || valor === "") {
    d.prepare("DELETE FROM config WHERE chave = ?").run(chave);
    return;
  }
  const cifrado = cifrar(valor.trim());
  d.prepare(`INSERT INTO config (chave, valor, atualizado_em) VALUES (?, ?, datetime('now'))
             ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`).run(chave, cifrado);
}

export function getAllConfig(): Record<string, string> {
  if (tenantId()) return Object.fromEntries(currentTenant().config.values);
  const linhas = abrir().prepare("SELECT chave, valor FROM config").all() as { chave: string; valor: string }[];
  const pares = linhas.map((l) => [l.chave, l.valor.startsWith("v1:") ? decifrar(l.valor) : l.valor] as const);
  return Object.fromEntries(pares.filter((par): par is [string, string] => par[1] !== undefined));
}

/** Indica de onde veio o valor, para a tela de setup mostrar "definido por variável de ambiente". */
export function origemConfig(chave: string): "env" | "banco" | null {
  if (tenantId()) return currentTenant().config.values.has(chave) ? "banco" : null;
  forbidLegacyStorage();
  if (process.env[chave]?.trim()) return "env";
  const linha = abrir().prepare("SELECT 1 FROM config WHERE chave = ?").get(chave);
  return linha ? "banco" : null;
}

/** Mostra só o começo e o fim de um segredo. */
export function mascarar(valor: string | undefined): string | null {
  if (!valor) return null;
  if (valor.length <= 8) return "••••";
  return `${valor.slice(0, 4)}••••${valor.slice(-4)}`;
}

/** Synchronous savepoint for a group of config changes; durable commit is awaited by the tenant boundary. */
export function configTransaction<T>(action: () => T): T {
  if (tenantId()) {
    const state = currentTenant().config;
    const values = new Map(state.values), dirty = new Set(state.dirty), guards = [...state.guards];
    try { return action(); }
    catch (error) { state.values = values; state.dirty = dirty; state.guards = guards; throw error; }
  }
  const db = abrir();
  db.exec("SAVEPOINT config_change");
  try { const result = action(); db.exec("RELEASE config_change"); return result; }
  catch (error) { db.exec("ROLLBACK TO config_change"); db.exec("RELEASE config_change"); throw error; }
}
