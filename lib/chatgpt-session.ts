import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { privateDataDirectory } from "./tenant-files";
import { currentTenant } from "./tenant-context";
import { AuthError, seal, unseal } from "./saas-security";
import type { Database } from "./saas-db";
import type { ChatAccount, DeviceLogin } from "./chatgpt";
import type { ModelCapability } from "./model-capabilities";

export type ChatSessionState = { auth: string | null; account: ChatAccount; models: ModelCapability[]; login: DeviceLogin | null; loginUntil?: number; modelsAt?: number };
const empty = (): ChatSessionState => ({ auth: null, account: null, models: [], login: null });
const aad = (owner: string) => `chatgpt-session:${owner}`;
function decode(ciphertext: string | null, owner: string) { return ciphertext ? JSON.parse(unseal(ciphertext, aad(owner))) as ChatSessionState : empty(); }
export async function readChatSession() {
  const { db, user } = currentTenant();
  const row = (await db.query<{ ciphertext: string | null; busy: boolean }>("SELECT ciphertext,coalesce(lease_until>now(),false) busy FROM chatgpt_sessions WHERE user_id=$1", [user.id])).rows[0];
  const state = decode(row?.ciphertext || null, user.id);
  if (!row?.busy || (state.loginUntil || 0) < Date.now()) state.login = null;
  return { state, busy: !!row?.busy };
}
export async function revokeChatSession(clear = true) {
  const { db, user } = currentTenant();
  await db.transaction(async sql => {
    const row = (await sql.query<{ ciphertext: string | null }>("SELECT ciphertext FROM chatgpt_sessions WHERE user_id=$1 FOR UPDATE", [user.id])).rows[0];
    if (!row) return;
    let ciphertext: string | null = null;
    if (!clear && row.ciphertext) {
      const state = decode(row.ciphertext, user.id); state.login = null; delete state.loginUntil;
      ciphertext = seal(JSON.stringify(state), aad(user.id));
    }
    await sql.query("UPDATE chatgpt_sessions SET ciphertext=$2,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1", [user.id, ciphertext]);
  });
}
/** An exclusive, renewable lease prevents concurrent native refreshes across app/workers. */
export class ChatSessionLease {
  readonly directory: string;
  readonly workspace: string;
  readonly token: string;
  state: ChatSessionState;
  private finished = false;
  private lastPayload: string;
  private db: Database;
  private owner: string;
  private constructor(db: Database, owner: string, token: string, state: ChatSessionState) {
    this.db = db; this.owner = owner;
    this.token = token; this.state = state; this.lastPayload = "";
    // Obsolete native caches are never imported or used after a vault revocation.
    const oldCache = join(privateDataDirectory(), "chatgpt");
    try {
      const stat = lstatSync(oldCache);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AuthError("Diretório ChatGPT antigo inseguro.");
      rmSync(oldCache, { recursive: true, force: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.directory = mkdtempSync(join(tmpdir(), "agentflows-codex-"));
    this.workspace = join(this.directory, "workspace");
    try {
      mkdirSync(this.workspace, { mode: 0o700 });
      if (state.auth) writeFileSync(join(this.directory, "auth.json"), state.auth, { mode: 0o600, flag: "wx" });
    } catch (error) { rmSync(this.directory, { recursive: true, force: true }); throw error; }
  }
  static async acquire() {
    const { db, user } = currentTenant(), token = randomUUID();
    const row = await db.transaction(async sql => {
      // The existing row also fences stale processes after logout and suspension.
      await sql.query("INSERT INTO chatgpt_sessions(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
      const { rows } = await sql.query<{ ciphertext: string | null }>(`UPDATE chatgpt_sessions SET lease_token=$2,lease_until=now()+interval '60 seconds'
        WHERE user_id=$1 AND (lease_until IS NULL OR lease_until<=now())
        AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND beta_status='approved' AND email_verified_at IS NOT NULL) RETURNING ciphertext`, [user.id, token]);
      if (!rows.length) throw new AuthError("Sua conexão ChatGPT está em uso. Aguarde e tente novamente.", 409);
      return rows[0];
    });
    try {
      const state = decode(row.ciphertext, user.id); state.login = null; delete state.loginUntil;
      return new ChatSessionLease(db, user.id, token, state);
    } catch {
      await db.query("UPDATE chatgpt_sessions SET lease_token=NULL,lease_until=NULL WHERE user_id=$1 AND lease_token=$2", [user.id, token]);
      throw new AuthError("Não foi possível abrir a sessão ChatGPT. Desconecte e conecte novamente.", 409);
    }
  }
  /** The only file read is the native auth cache; symlinks, devices and large files fail closed. */
  private capture() {
    let fd: number;
    try { fd = openSync(join(this.directory, "auth.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.state.auth = null; return; } throw new AuthError("Arquivo de sessão ChatGPT inválido."); }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 65536) throw new AuthError("Arquivo de sessão ChatGPT inválido.");
      const value = readFileSync(fd, "utf8");
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      this.state.auth = value;
    } catch { throw new AuthError("Arquivo de sessão ChatGPT inválido."); }
    finally { closeSync(fd); }
  }
  async sync(release = false) {
    if (this.finished) throw new AuthError("Sessão ChatGPT encerrada.", 409);
    this.capture();
    const payload = JSON.stringify(this.state);
    if (Buffer.byteLength(payload) > 256 * 1024) throw new AuthError("Sessão ChatGPT excedeu o limite.");
    const changed = payload !== this.lastPayload;
    const { rows } = await this.db.query(`UPDATE chatgpt_sessions SET ciphertext=CASE WHEN $3 THEN $4 ELSE ciphertext END,
      lease_token=CASE WHEN $5 THEN NULL ELSE lease_token END,
      lease_until=CASE WHEN $5 THEN NULL ELSE now()+interval '60 seconds' END,updated_at=now()
      WHERE user_id=$1 AND lease_token=$2 AND lease_until>now()
      AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND beta_status='approved' AND email_verified_at IS NOT NULL) RETURNING user_id`,
      [this.owner, this.token, changed, changed ? seal(payload, aad(this.owner)) : null, release]);
    if (!rows.length) throw new AuthError("A sessão ChatGPT foi revogada ou sua autorização expirou.", 409);
    this.lastPayload = payload;
    if (release) this.finished = true;
  }
  /** Call after the native process exits so it cannot recreate plaintext files. */
  async dispose() {
    try { await this.db.query("UPDATE chatgpt_sessions SET lease_token=NULL,lease_until=NULL WHERE user_id=$1 AND lease_token=$2", [this.owner, this.token]); }
    finally { this.finished = true; rmSync(this.directory, { recursive: true, force: true }); }
  }
}
