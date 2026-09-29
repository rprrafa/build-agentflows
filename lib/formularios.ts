// Biblioteca de formulários públicos: um link (/f/[token]) que qualquer pessoa preenche sem login,
// para o app coletar dados de fora (ex.: autoavaliação do colaborador). Usa o mesmo arquivo SQLite
// de lib/store.ts/lib/historico.ts, em duas tabelas próprias. Copie este arquivo para cada app sem alterar.
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { forbidLegacyStorage } from "./tenant-context";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
let db: DatabaseSync | null = null;

function abrir(): DatabaseSync {
  forbidLegacyStorage();
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "app.sqlite"));
  db.exec(`CREATE TABLE IF NOT EXISTS formularios (
    token TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    campos TEXT NOT NULL,
    parametros TEXT NOT NULL,
    expiraEm TEXT NULL,
    limite INTEGER NULL,
    criadoEm TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS respostas (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    dados TEXT NOT NULL,
    resultadoId TEXT NULL,
    criadoEm TEXT NOT NULL
  )`);
  return db;
}

/** Um campo declarado pelo app: chave usada em `dados`, rótulo exibido e o tipo de controle na tela pública.
 * "arquivo" lê o conteúdo do arquivo escolhido como texto (ex.: CSV) e guarda em `dados` como qualquer outro campo;
 * `aceitar` vira o atributo `accept` do seletor de arquivo. "nota" é uma escala fixa de 0 a 10 (ex.: pergunta de NPS),
 * exibida como botões na tela pública; o valor guardado em `dados` é o número escolhido como string ("0" a "10").
 * "decisao" é uma escolha fixa entre aprovar, pedir ajuste ou descartar (ex.: aprovação de rascunhos por link),
 * exibida como três botões; o valor guardado em `dados` é "aprovar", "ajustar" ou "descartar".
 * "escala" é uma escala configurável (`min`/`max`, padrão 1 a 5, com `rotuloMin`/`rotuloMax` nas pontas),
 * exibida como botões em linha; o valor guardado é o número escolhido como string. "escolha" é uma lista de
 * `opcoes` ({valor,rotulo}) exibida como rádio (uma resposta) ou caixas quando `multipla` (várias respostas,
 * guardadas como os valores escolhidos separados por vírgula). `secao` agrupa perguntas visualmente sob um
 * subtítulo na tela pública: aparece antes do campo sempre que o valor mudar em relação ao campo anterior. */
export type CampoFormulario = {
  chave: string;
  rotulo: string;
  tipo: "texto" | "textarea" | "arquivo" | "nota" | "decisao" | "escala" | "escolha";
  obrigatorio?: boolean;
  aceitar?: string;
  secao?: string;
  min?: number;
  max?: number;
  rotuloMin?: string;
  rotuloMax?: string;
  opcoes?: { valor: string; rotulo: string }[];
  multipla?: boolean;
};

/** Dados exibidos pela tela pública genérica (app/f/[token]/page.tsx), guardados dentro de `parametros`.
 * `agradecimento`, quando presente, substitui o texto padrão de sucesso após o envio (ex.: confirmar em qual
 * avaliação/pesquisa a resposta entrou); sem ele, a tela mostra "Obrigado, sua resposta foi enviada.". */
export type ParametrosPublicos = { marca: string; nome: string; titulo: string; descricao?: string; agradecimento?: string };

export type Formulario<P = unknown> = {
  token: string;
  tipo: string;
  campos: CampoFormulario[];
  parametros: P;
  expiraEm: string | null;
  limite: number | null;
  criadoEm: string;
};

export type RespostaFormulario<D = Record<string, string>> = { id: string; token: string; dados: D; resultadoId: string | null; criadoEm: string };

type LinhaFormulario = { token: string; tipo: string; campos: string; parametros: string; expiraEm: string | null; limite: number | null; criadoEm: string };
type LinhaResposta = { id: string; token: string; dados: string; resultadoId: string | null; criadoEm: string };

function linhaParaFormulario<P>(l: LinhaFormulario): Formulario<P> {
  return { token: l.token, tipo: l.tipo, campos: JSON.parse(l.campos), parametros: JSON.parse(l.parametros), expiraEm: l.expiraEm, limite: l.limite, criadoEm: l.criadoEm };
}

function linhaParaResposta<D>(l: LinhaResposta): RespostaFormulario<D> {
  return { id: l.id, token: l.token, dados: JSON.parse(l.dados), resultadoId: l.resultadoId, criadoEm: l.criadoEm };
}

/** Token aleatório de 16 caracteres, seguro para URL (base64url de 12 bytes). */
function gerarToken(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function gerarId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

/** Cria um formulário público e devolve o token do link (/f/<token>). */
export function criar({ tipo, campos, parametros, expiraEmDias, limite }: { tipo: string; campos: CampoFormulario[]; parametros: unknown; expiraEmDias?: number; limite?: number }): string {
  const token = gerarToken();
  const criadoEm = new Date().toISOString();
  const expiraEm = expiraEmDias ? new Date(Date.now() + expiraEmDias * 24 * 60 * 60 * 1000).toISOString() : null;
  abrir()
    .prepare("INSERT INTO formularios (token, tipo, campos, parametros, expiraEm, limite, criadoEm) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(token, tipo, JSON.stringify(campos), JSON.stringify(parametros), expiraEm, limite ?? null, criadoEm);
  return token;
}

export function obter<P = unknown>(token: string): Formulario<P> | null {
  const linha = abrir().prepare("SELECT * FROM formularios WHERE token = ?").get(token) as LinhaFormulario | undefined;
  return linha ? linhaParaFormulario<P>(linha) : null;
}

/** Formulários de um `tipo`, mais recentes primeiro (ex.: listar "Pesquisas ativas" de um link reaproveitado várias vezes). */
export function listarPorTipo<P = unknown>(tipo: string, limite = 50): Formulario<P>[] {
  const linhas = abrir()
    .prepare("SELECT * FROM formularios WHERE tipo = ? ORDER BY criadoEm DESC LIMIT ?")
    .all(tipo, limite) as LinhaFormulario[];
  return linhas.map((l) => linhaParaFormulario<P>(l));
}

/** Total de respostas de um formulário, sem o limite de `listarRespostas`. */
export function contarRespostas(token: string): number {
  const linha = abrir().prepare("SELECT COUNT(*) AS total FROM respostas WHERE token = ?").get(token) as { total: number };
  return linha.total;
}

/** Encerra manualmente um link (define expiraEm para agora): para de aceitar respostas novas sem apagar as já recebidas. */
export function encerrar(token: string): void {
  abrir().prepare("UPDATE formularios SET expiraEm = ? WHERE token = ?").run(new Date().toISOString(), token);
}

/** true quando o formulário já passou do prazo; centralizado aqui para nunca chamar Date.now() direto de um componente. */
export function expirou(formulario: Pick<Formulario, "expiraEm">): boolean {
  return formulario.expiraEm !== null && new Date(formulario.expiraEm).getTime() < Date.now();
}

export type ResultadoResposta = { ok: true; id: string } | { ok: false; motivo: "invalido" | "expirado" | "limite" };

/** Valida expiração/limite e grava a resposta; resultadoId (opcional) vem do callback que o app já rodou. */
export function responder(token: string, dados: Record<string, string>, resultadoId?: string): ResultadoResposta {
  const formulario = obter(token);
  if (!formulario) return { ok: false, motivo: "invalido" };
  if (expirou(formulario)) return { ok: false, motivo: "expirado" };
  if (formulario.limite !== null && listarRespostas(token).length >= formulario.limite) return { ok: false, motivo: "limite" };

  const id = gerarId();
  const criadoEm = new Date().toISOString();
  abrir()
    .prepare("INSERT INTO respostas (id, token, dados, resultadoId, criadoEm) VALUES (?, ?, ?, ?, ?)")
    .run(id, token, JSON.stringify(dados), resultadoId ?? null, criadoEm);
  return { ok: true, id };
}

/** Lista as respostas mais recentes primeiro. */
export function listarRespostas<D = Record<string, string>>(token: string, limite = 50): RespostaFormulario<D>[] {
  const linhas = abrir()
    .prepare("SELECT * FROM respostas WHERE token = ? ORDER BY criadoEm DESC LIMIT ?")
    .all(token, limite) as LinhaResposta[];
  return linhas.map((l) => linhaParaResposta<D>(l));
}

/** Respostas mais recentes de um `tipo`, juntando vários formulários/tokens (ex.: um convite por pessoa). */
export function listarRespostasPorTipo<D = Record<string, string>>(tipo: string, limite = 50): RespostaFormulario<D>[] {
  const linhas = abrir()
    .prepare("SELECT r.* FROM respostas r JOIN formularios f ON r.token = f.token WHERE f.tipo = ? ORDER BY r.criadoEm DESC LIMIT ?")
    .all(tipo, limite) as LinhaResposta[];
  return linhas.map((l) => linhaParaResposta<D>(l));
}

/** Apaga o formulário e as respostas recebidas por ele. */
export function apagar(token: string): void {
  const d = abrir();
  d.prepare("DELETE FROM respostas WHERE token = ?").run(token);
  d.prepare("DELETE FROM formularios WHERE token = ?").run(token);
}

/** Remove formulários expirados (e suas respostas); roda na inicialização do servidor (ver instrumentation.ts). */
export function limparExpirados(): void {
  const d = abrir();
  const expirados = d.prepare("SELECT token FROM formularios WHERE expiraEm IS NOT NULL AND expiraEm < ?").all(new Date().toISOString()) as { token: string }[];
  for (const { token } of expirados) apagar(token);
}

/**
 * Callback que o app declara para um `tipo` de formulário: recebe as respostas e pode gerar um
 * resultado (ex.: salvar em lib/historico.ts) devolvendo o resultadoId a ser guardado na resposta.
 * Cada app registra o seu na inicialização do módulo que já tem a lógica (ex.: lib/pdi.ts).
 */
export type CallbackFormulario = (ctx: { token: string; dados: Record<string, string>; parametros: unknown }) => Promise<{ resultadoId?: string } | void> | { resultadoId?: string } | void;

const callbacks = new Map<string, CallbackFormulario>();

export function registrarCallback(tipo: string, fn: CallbackFormulario): void {
  callbacks.set(tipo, fn);
}

export function obterCallback(tipo: string): CallbackFormulario | undefined {
  return callbacks.get(tipo);
}
