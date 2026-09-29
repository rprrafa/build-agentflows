// Rotinas: tarefas agendadas (diária/semanal/mensal/única) que o app executa sozinho, entregando o
// resultado por notificação (lib/notificacoes.ts). Usa o mesmo arquivo SQLite de lib/store.ts. Copie
// este arquivo para cada app sem alterar; o que cada `tipo` de rotina faz é registrado por
// lib/rotinas-do-app.ts (arquivo próprio de cada app, não compartilhado).
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { forbidLegacyStorage } from "./tenant-context";
import { caixaConectada } from "./email-envio";
import { enviar, type Canal } from "./notificacoes";
import { getAllConfig, getConfig, mascarar, setConfig } from "./store";
import { enderecoPublico } from "./setup-comum";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
let db: DatabaseSync | null = null;

function abrir(): DatabaseSync {
  forbidLegacyStorage();
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "app.sqlite"));
  db.exec(`CREATE TABLE IF NOT EXISTS rotinas (
    id TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    frequencia TEXT NOT NULL,
    hora TEXT NOT NULL,
    diaSemana INTEGER NULL,
    diaMes INTEGER NULL,
    dataUnica TEXT NULL,
    canal TEXT NOT NULL,
    destino TEXT NULL,
    parametros TEXT NOT NULL,
    ativa INTEGER NOT NULL DEFAULT 1,
    ultimaExecucao TEXT NULL,
    criadoEm TEXT NOT NULL
  )`);
  // Bancos criados antes da US-023 não têm estas colunas; ALTER TABLE falha silenciosamente quando já existem.
  try { db.exec(`ALTER TABLE rotinas ADD COLUMN ultimaFalha TEXT NULL`); } catch { /* coluna já existe */ }
  try { db.exec(`ALTER TABLE rotinas ADD COLUMN falhasSeguidas INTEGER NOT NULL DEFAULT 0`); } catch { /* coluna já existe */ }
  return db;
}

export type Frequencia = "diaria" | "semanal" | "mensal" | "unica";

export type Rotina<P = unknown> = {
  id: string;
  tipo: string;
  frequencia: Frequencia;
  /** "HH:MM", horário do relógio do servidor. */
  hora: string;
  /** 0 (domingo) a 6 (sábado); só para frequencia "semanal". */
  diaSemana: number | null;
  /** 1 a 31; só para frequencia "mensal" (dias além do fim do mês caem no último dia). */
  diaMes: number | null;
  /** "AAAA-MM-DD"; só para frequencia "unica". */
  dataUnica: string | null;
  canal: Canal;
  destino: string | null;
  parametros: P;
  ativa: boolean;
  ultimaExecucao: string | null;
  /** Motivo da última falha (ex.: canal de notificação não configurado); null quando a última execução deu certo ou a rotina nunca rodou. */
  ultimaFalha: string | null;
  /** Falhas seguidas desde o último sucesso; ao chegar a 3, a rotina é pausada automaticamente. */
  falhasSeguidas: number;
  criadoEm: string;
};

type Linha = {
  id: string; tipo: string; frequencia: string; hora: string;
  diaSemana: number | null; diaMes: number | null; dataUnica: string | null;
  canal: string; destino: string | null; parametros: string;
  ativa: number; ultimaExecucao: string | null; ultimaFalha: string | null; falhasSeguidas: number; criadoEm: string;
};

function linhaParaRotina<P>(l: Linha): Rotina<P> {
  return {
    id: l.id,
    tipo: l.tipo,
    frequencia: l.frequencia as Frequencia,
    hora: l.hora,
    diaSemana: l.diaSemana,
    diaMes: l.diaMes,
    dataUnica: l.dataUnica,
    canal: l.canal as Canal,
    destino: l.destino,
    parametros: JSON.parse(l.parametros),
    ativa: Boolean(l.ativa),
    ultimaExecucao: l.ultimaExecucao,
    ultimaFalha: l.ultimaFalha,
    falhasSeguidas: l.falhasSeguidas,
    criadoEm: l.criadoEm,
  };
}

function gerarId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

export function criar({ tipo, frequencia, hora, diaSemana, diaMes, dataUnica, canal, destino, parametros }: {
  tipo: string; frequencia: Frequencia; hora: string;
  diaSemana?: number; diaMes?: number; dataUnica?: string;
  canal: Canal; destino?: string; parametros?: unknown;
}): string {
  const id = gerarId();
  abrir()
    .prepare(
      `INSERT INTO rotinas (id, tipo, frequencia, hora, diaSemana, diaMes, dataUnica, canal, destino, parametros, ativa, ultimaExecucao, criadoEm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`
    )
    .run(id, tipo, frequencia, hora, diaSemana ?? null, diaMes ?? null, dataUnica ?? null, canal, destino ?? null, JSON.stringify(parametros ?? {}), new Date().toISOString());
  return id;
}

export function listar<P = unknown>(): Rotina<P>[] {
  const linhas = abrir().prepare("SELECT * FROM rotinas ORDER BY criadoEm DESC").all() as Linha[];
  return linhas.map((l) => linhaParaRotina<P>(l));
}

export function obter<P = unknown>(id: string): Rotina<P> | null {
  const linha = abrir().prepare("SELECT * FROM rotinas WHERE id = ?").get(id) as Linha | undefined;
  return linha ? linhaParaRotina<P>(linha) : null;
}

/** Ativa ou pausa uma rotina (o agendador ignora rotinas pausadas). */
export function pausar(id: string, ativa: boolean): void {
  abrir().prepare("UPDATE rotinas SET ativa = ? WHERE id = ?").run(ativa ? 1 : 0, id);
}

export function apagar(id: string): void {
  abrir().prepare("DELETE FROM rotinas WHERE id = ?").run(id);
}

/** Execução bem-sucedida (ou sem nada a avisar): limpa a sequência de falhas. */
function marcarSucesso(id: string, quando: string): void {
  abrir().prepare("UPDATE rotinas SET ultimaExecucao = ?, ultimaFalha = NULL, falhasSeguidas = 0 WHERE id = ?").run(quando, id);
}

/** Execução falhou: registra o motivo e, na 3ª falha seguida, pausa a rotina (o agendador ignora rotinas pausadas). */
function marcarFalha(id: string, quando: string, motivo: string): void {
  const linha = abrir().prepare("SELECT falhasSeguidas FROM rotinas WHERE id = ?").get(id) as { falhasSeguidas: number } | undefined;
  const falhasSeguidas = (linha?.falhasSeguidas ?? 0) + 1;
  abrir().prepare("UPDATE rotinas SET ultimaExecucao = ?, ultimaFalha = ?, falhasSeguidas = ? WHERE id = ?").run(quando, motivo, falhasSeguidas, id);
  if (falhasSeguidas >= 3) pausar(id, false);
}

/** Tipo de rotina disponível para um app criar (ver lib/rotinas-do-app.ts, arquivo próprio de cada app, para a lista real). */
export type TipoRotina<P = unknown> = {
  tipo: string;
  rotulo: string;
  /** Confere os parâmetros específicos desta rotina (ex.: temas, empresa) antes de criar; devolve a mensagem de erro, ou undefined quando pode criar. */
  validar?: (parametros: P, config: Record<string, string | undefined>) => string | undefined;
};

/** Motivo pelo qual o canal escolhido ainda não consegue entregar (nenhuma credencial configurada para ele), ou undefined quando pode enviar. */
export function motivoCanalIndisponivel(canal: Canal): string | undefined {
  if (canal === "slack") {
    return getConfig("NOTIFICACOES_SLACK_WEBHOOK") ? undefined : "Configure o webhook do Slack em Notificações antes de criar uma rotina por esse canal.";
  }
  // Uma caixa própria conectada (Gmail/Outlook, US-024) também entrega por e-mail, não só Resend/SMTP.
  const temEmail = Boolean(caixaConectada("gmail") || caixaConectada("outlook") || getConfig("NOTIFICACOES_RESEND_API_KEY") || getConfig("NOTIFICACOES_SMTP_HOST"));
  return temEmail ? undefined : "Conecte seu Gmail ou Outlook, ou configure o Resend ou o SMTP, em Notificações antes de criar uma rotina por e-mail.";
}

/** Roda o `validar` do tipo escolhido (quando existe) contra os parâmetros recebidos. */
export function validarParametrosTipo(tipo: string, parametros: unknown, tipos: TipoRotina[]): string | undefined {
  const def = tipos.find((t) => t.tipo === tipo);
  return def?.validar ? def.validar(parametros, getAllConfig()) : undefined;
}

/** O que um `tipo` de rotina devolve ao rodar; vira a notificação enviada (titulo, texto e, quando houver, o link /r/<resultadoId>). enviar: false (ex.: uma rotina de alerta que só deve falar quando algo mudou) pula o envio desta execução, sem deixar de marcar a rotina como executada. */
export type ResultadoRotina = { titulo: string; texto: string; resultadoId?: string; enviar?: boolean };
export type ExecutorRotina = (rotina: Rotina) => Promise<ResultadoRotina>;

const executores = new Map<string, ExecutorRotina>();

/** Cada app registra aqui o que cada `tipo` de rotina faz (ver lib/rotinas-do-app.ts, arquivo próprio do app). */
export function registrarExecutor(tipo: string, fn: ExecutorRotina): void {
  executores.set(tipo, fn);
}

/** Horário mais recente (hora local do servidor) em que a rotina deveria ter rodado até agora, ou null se a vez dela ainda não chegou. */
function ultimoHorarioDevido(r: Pick<Rotina, "frequencia" | "hora" | "diaSemana" | "diaMes" | "dataUnica">, agora: Date): Date | null {
  const [h, m] = r.hora.split(":").map(Number);

  if (r.frequencia === "unica") {
    if (!r.dataUnica) return null;
    const alvo = new Date(`${r.dataUnica}T00:00:00`);
    alvo.setHours(h, m, 0, 0);
    return alvo <= agora ? alvo : null;
  }

  if (r.frequencia === "diaria") {
    const alvo = new Date(agora);
    alvo.setHours(h, m, 0, 0);
    if (alvo > agora) alvo.setDate(alvo.getDate() - 1);
    return alvo;
  }

  if (r.frequencia === "semanal") {
    const diaSemana = r.diaSemana ?? 0;
    const alvo = new Date(agora);
    alvo.setHours(h, m, 0, 0);
    const diff = (alvo.getDay() - diaSemana + 7) % 7;
    alvo.setDate(alvo.getDate() - diff);
    if (alvo > agora) alvo.setDate(alvo.getDate() - 7);
    return alvo;
  }

  // mensal
  const diaMes = r.diaMes ?? 1;
  const ultimoDiaMesAtual = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const alvo = new Date(agora.getFullYear(), agora.getMonth(), Math.min(diaMes, ultimoDiaMesAtual), h, m, 0, 0);
  if (alvo <= agora) return alvo;
  const ultimoDiaMesAnterior = new Date(agora.getFullYear(), agora.getMonth(), 0).getDate();
  return new Date(agora.getFullYear(), agora.getMonth() - 1, Math.min(diaMes, ultimoDiaMesAnterior), h, m, 0, 0);
}

function devida(r: Rotina, agora: Date): boolean {
  if (!r.ativa) return false;
  const alvo = ultimoHorarioDevido(r, agora);
  if (!alvo) return false;
  if (!r.ultimaExecucao) return true;
  return new Date(r.ultimaExecucao) < alvo;
}

async function executar(r: Rotina): Promise<{ id: string; ok: boolean; mensagem: string }> {
  const agora = new Date().toISOString();
  const executor = executores.get(r.tipo);
  if (!executor) {
    const mensagem = `Nenhuma ação registrada para o tipo "${r.tipo}".`;
    marcarFalha(r.id, agora, mensagem);
    return { id: r.id, ok: false, mensagem };
  }
  try {
    const resultado = await executor(r);
    if (resultado.enviar === false) {
      marcarSucesso(r.id, agora);
      return { id: r.id, ok: true, mensagem: "Nada para avisar desta vez." };
    }
    const base = enderecoPublico();
    if (!base && resultado.resultadoId) console.error(`Rotina "${r.tipo}": endereço público desconhecido, link omitido do aviso.`);
    const envio = await enviar({
      canal: r.canal,
      destino: r.destino ?? undefined,
      titulo: resultado.titulo,
      texto: resultado.texto,
      link: base && resultado.resultadoId ? `${base}/r/${resultado.resultadoId}` : undefined,
    });
    if (envio.ok) marcarSucesso(r.id, agora);
    else marcarFalha(r.id, agora, envio.mensagem);
    return { id: r.id, ok: envio.ok, mensagem: envio.mensagem };
  } catch (err) {
    console.error(`Falha ao executar a rotina "${r.tipo}":`, err);
    const mensagem = err instanceof Error && err.message ? err.message : "Não foi possível concluir esta rotina agora. Tente executar de novo em Configurações.";
    marcarFalha(r.id, agora, mensagem);
    return { id: r.id, ok: false, mensagem };
  }
}

/** Executa todas as rotinas ativas cuja vez já chegou. Chamada pelo executor de 60s (instrumentation.ts) e pelo gatilho externo (POST /api/rotinas/executar). */
export async function executarVencidas(agora = new Date()): Promise<{ id: string; ok: boolean; mensagem: string }[]> {
  const vencidas = listar().filter((r) => devida(r, agora));
  const resultados: { id: string; ok: boolean; mensagem: string }[] = [];
  for (const r of vencidas) resultados.push(await executar(r));
  return resultados;
}

/** Executa uma rotina agora, ignorando o agendamento ("Executar agora" no cartão de /setup). */
export async function executarAgora(id: string): Promise<{ id: string; ok: boolean; mensagem: string } | null> {
  const r = obter(id);
  if (!r) return null;
  return executar(r);
}

const CHAVE_CODIGO = "ROTINAS_CODIGO_ACESSO";

export function codigoAtivo(): string | undefined {
  return getConfig(CHAVE_CODIGO);
}

export function codigoMascarado(): string | null {
  return mascarar(codigoAtivo());
}

/** Gera um novo código de acesso do gatilho externo e invalida o anterior. */
export function gerarCodigo(): string {
  const codigo = crypto.randomBytes(32).toString("base64url");
  setConfig(CHAVE_CODIGO, codigo);
  return codigo;
}

export function revogarCodigo(): void {
  setConfig(CHAVE_CODIGO, null);
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
