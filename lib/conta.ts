// Conta de administrador e sessão do app (uma conta por instância).
// Sem dependência nova: senha com crypto.scrypt do Node, sessão com token aleatório
// guardado como hash SHA-256 no mesmo app.sqlite. Copie sem alterar ao replicar.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { abrirBanco } from "./store";
import { REGRA_SENHA, senhaFraca, forcaSenha, emailInvalido, type Forca } from "./conta-comum";

export { REGRA_SENHA, senhaFraca, forcaSenha, emailInvalido, type Forca };

export type Usuario = { id: number; nome: string; email: string };

const DIAS_DE_SESSAO = 30;
const TENTATIVAS_ATE_ESPERAR = 5;
const ESPERA_MS = 60_000;
const CACHE_SESSAO_MS = 60_000;

/** N do scrypt: ~50 ms por verificação, aceitável para uma conta por instância. */
const SCRYPT_N = 16384;
const SCRYPT_TAMANHO = 64;

let criado = false;

function banco() {
  const d = abrirBanco();
  if (!criado) {
    d.exec(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    d.exec(`CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      expira_em TEXT NOT NULL
    )`);
    criado = true;
  }
  return d;
}

// --- Senha ---------------------------------------------------------------

function gerarHash(senha: string): string {
  const sal = randomBytes(16);
  const derivada = scryptSync(senha.normalize("NFKC"), sal, SCRYPT_TAMANHO, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${sal.toString("hex")}$${derivada.toString("hex")}`;
}

function conferirHash(senha: string, guardado: string): boolean {
  const partes = guardado.split("$");
  if (partes.length !== 4 || partes[0] !== "scrypt") return false;
  const n = Number(partes[1]);
  const sal = Buffer.from(partes[2], "hex");
  const esperado = Buffer.from(partes[3], "hex");
  const derivada = scryptSync(senha.normalize("NFKC"), sal, esperado.length, { N: n });
  return timingSafeEqual(derivada, esperado);
}

// --- Conta ---------------------------------------------------------------

export function existeConta(): boolean {
  const linha = banco().prepare("SELECT 1 FROM usuarios LIMIT 1").get();
  return Boolean(linha);
}

export function criarConta(dados: { nome: string; email: string; senha: string }): Usuario {
  const nome = dados.nome.trim();
  const email = dados.email.trim().toLowerCase();
  if (existeConta()) throw new ErroConta("Este app já tem uma conta. Entre com o seu e-mail e senha.", 409);
  if (!nome) throw new ErroConta("Escreva o seu nome.", 400);
  const erroEmail = emailInvalido(email);
  if (erroEmail) throw new ErroConta(erroEmail, 400);
  const erroSenha = senhaFraca(dados.senha);
  if (erroSenha) throw new ErroConta(erroSenha, 400);
  const d = banco();
  d.prepare("INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)").run(nome, email, gerarHash(dados.senha));
  const linha = d.prepare("SELECT id, nome, email FROM usuarios WHERE email = ?").get(email) as Usuario;
  return linha;
}

export class ErroConta extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.status = status;
  }
}

// Contador de tentativas em memória: uma conta por instância, não precisa de tabela.
const tentativas = new Map<string, { falhas: number; ate: number }>();

export function entrar(dados: { email: string; senha: string }): { usuario: Usuario; token: string } {
  const email = dados.email.trim().toLowerCase();
  const bloqueio = tentativas.get(email);
  if (bloqueio && bloqueio.falhas >= TENTATIVAS_ATE_ESPERAR && Date.now() < bloqueio.ate) {
    throw new ErroConta("Muitas tentativas. Espere um minuto e tente de novo.", 429);
  }
  const d = banco();
  const linha = d.prepare("SELECT id, nome, email, senha_hash FROM usuarios WHERE email = ?").get(email) as
    | (Usuario & { senha_hash: string })
    | undefined;
  const ok = linha ? conferirHash(dados.senha, linha.senha_hash) : false;
  if (!linha || !ok) {
    const atual = tentativas.get(email);
    const falhas = (atual && Date.now() < atual.ate ? atual.falhas : 0) + 1;
    tentativas.set(email, { falhas, ate: Date.now() + ESPERA_MS });
    throw new ErroConta("E-mail ou senha não conferem. Tente de novo.", 401);
  }
  tentativas.delete(email);
  const usuario: Usuario = { id: linha.id, nome: linha.nome, email: linha.email };
  return { usuario, token: abrirSessao(usuario.id) };
}

/** Troca a senha da conta existente. Usado pela variável NOVA_SENHA_ADMIN na subida. */
export function trocarSenha(senha: string): boolean {
  const erro = senhaFraca(senha);
  if (erro) throw new ErroConta(erro, 400);
  const d = banco();
  const linha = d.prepare("SELECT id FROM usuarios LIMIT 1").get() as { id: number } | undefined;
  if (!linha) return false;
  d.prepare("UPDATE usuarios SET senha_hash = ? WHERE id = ?").run(gerarHash(senha), linha.id);
  d.prepare("DELETE FROM sessoes").run();
  cache.clear();
  // Quem redefine a senha costuma estar travado pelas tentativas: liberar junto.
  tentativas.clear();
  return true;
}

/** Render sem disco persistente: `RENDER_DISK_ID` só existe quando o Blueprint tem o bloco `disk` ativado. */
export function discoEfemero(): boolean {
  return Boolean(process.env.RENDER) && !process.env.RENDER_DISK_ID;
}

let redefinicaoFeita = false;

/** Lida uma vez na subida: redefine a senha da conta quando NOVA_SENHA_ADMIN está no ambiente. */
export function aplicarRedefinicaoDeSenha(): void {
  if (redefinicaoFeita) return;
  redefinicaoFeita = true;
  const nova = process.env.NOVA_SENHA_ADMIN?.trim();
  if (!nova) return;
  try {
    if (trocarSenha(nova)) {
      console.warn("NOVA_SENHA_ADMIN: senha da conta redefinida e sessões encerradas. Remova a variável depois de entrar.");
    } else {
      console.warn("NOVA_SENHA_ADMIN: nenhuma conta criada ainda; nada a redefinir.");
    }
  } catch (err) {
    console.error("NOVA_SENHA_ADMIN recusada:", err instanceof Error ? err.message : err);
  }
}

// --- Sessão --------------------------------------------------------------

const cache = new Map<string, { usuario: Usuario; ate: number }>();

function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function abrirSessao(usuarioId: number): string {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DIAS_DE_SESSAO * 86_400_000).toISOString();
  banco()
    .prepare("INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)")
    .run(hashDoToken(token), usuarioId, expira);
  return token;
}

export const COOKIE_SESSAO = "sessao";

/** Lê o cookie de sessão e devolve quem está usando o app, ou null. */
export function sessaoAtual(req: { headers: { get(nome: string): string | null } }): Usuario | null {
  const token = lerCookie(req.headers.get("cookie"), COOKIE_SESSAO);
  if (!token) return null;
  return usuarioDoToken(token);
}

export function usuarioDoToken(token: string): Usuario | null {
  const emCache = cache.get(token);
  if (emCache && Date.now() < emCache.ate) return emCache.usuario;
  const linha = banco()
    .prepare(
      `SELECT u.id, u.nome, u.email FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token_hash = ? AND s.expira_em > datetime('now')`,
    )
    .get(hashDoToken(token)) as Usuario | undefined;
  if (!linha) {
    cache.delete(token);
    return null;
  }
  // Renova a validade a cada acesso autenticado (rolling session).
  const expira = new Date(Date.now() + DIAS_DE_SESSAO * 86_400_000).toISOString();
  banco().prepare("UPDATE sessoes SET expira_em = ? WHERE token_hash = ?").run(expira, hashDoToken(token));
  cache.set(token, { usuario: linha, ate: Date.now() + CACHE_SESSAO_MS });
  return linha;
}

export function sair(token: string | null | undefined): void {
  if (!token) return;
  banco().prepare("DELETE FROM sessoes WHERE token_hash = ?").run(hashDoToken(token));
  cache.delete(token);
}

export function lerCookie(cabecalho: string | null, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

/** Monta o Set-Cookie da sessão. `seguro` vem de a requisição ter chegado por https. */
export function cookieDeSessao(token: string, seguro: boolean): string {
  const partes = [
    `${COOKIE_SESSAO}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${DIAS_DE_SESSAO * 86_400}`,
  ];
  if (seguro) partes.push("Secure");
  return partes.join("; ");
}

export function cookieDeSaida(seguro: boolean): string {
  const partes = [`${COOKIE_SESSAO}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (seguro) partes.push("Secure");
  return partes.join("; ");
}

/** Remove sessões vencidas. Chamado de vez em quando, sem custo relevante. */
export function limparSessoesVencidas(): void {
  banco().prepare("DELETE FROM sessoes WHERE expira_em <= datetime('now')").run();
}
