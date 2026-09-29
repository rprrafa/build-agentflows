import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, writeFileSync, readFileSync, symlinkSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTenantTestContext } from "../scripts/tenant-test-context";
import { ChatSessionLease, readChatSession, revokeChatSession } from "./chatgpt-session";
import { ChatGPTBridge } from "./chatgpt";
import { privateDataDirectory } from "./tenant-files";
import { withTenantSession } from "./tenant-context";
import { hashToken, randomToken } from "./saas-security";
const data = mkdtempSync(join(tmpdir(), "agentflows-chat-session-test-"));
process.env.DATA_DIR = data;
test.after(() => rmSync(data, { recursive: true, force: true }));

async function setup(t: TestContext) {
  const x = await createTenantTestContext(); t.after(x.close);
  const ownerB = randomUUID(), tokenB = randomToken();
  await x.db.query("INSERT INTO users(id,name,email,email_verified_at,beta_status) VALUES($1,'B',$2,now(),'approved')", [ownerB, `${ownerB}@example.com`]);
  await x.db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hashToken(tokenB), ownerB]);
  return { ...x, ownerB, asB: <T>(fn: () => T | Promise<T>) => withTenantSession(x.db, tokenB, fn) };
}
function auth(lease: ChatSessionLease, secret = "private-refresh-token") {
  writeFileSync(join(lease.directory, "auth.json"), JSON.stringify({ tokens: { access_token: "private-access-token", refresh_token: secret } }), { mode: 0o600 });
}

test("sessão ChatGPT fica cifrada por dono, restaura no temporário e limpa depois", async t => {
  const x = await setup(t);
  const old = await x.asTenant(() => privateDataDirectory("chatgpt"));
  writeFileSync(join(old, "auth.json"), "old-plaintext-not-imported");
  const a = await x.asTenant(() => ChatSessionLease.acquire()), b = await x.asB(() => ChatSessionLease.acquire());
  try {
    assert.equal(existsSync(old), false);
    assert.notEqual(a.directory, b.directory);
    assert.equal(statSync(a.directory).mode & 0o777, 0o700);
    auth(a); await a.sync();
    auth(a, "refreshed-token"); await a.sync(true);
    const raw = JSON.stringify((await x.db.query("SELECT * FROM chatgpt_sessions")).rows);
    assert.ok(!raw.includes("refreshed-token")); assert.ok(!raw.includes("private-access-token"));
    assert.equal((await x.asB(readChatSession)).state.auth, null);
    await a.dispose(); assert.equal(existsSync(a.directory), false);
    const restored = await x.asTenant(() => ChatSessionLease.acquire());
    try { assert.match(readFileSync(join(restored.directory, "auth.json"), "utf8"), /refreshed-token/); assert.equal(statSync(join(restored.directory, "auth.json")).mode & 0o777, 0o600); }
    finally { await restored.dispose(); }
  } finally { await a.dispose(); await b.dispose(); }
});

test("trava de sessão impede refresh simultâneo e expiração bloqueia gravação antiga", async t => {
  const x = await setup(t);
  const results = await Promise.allSettled([x.asTenant(() => ChatSessionLease.acquire()), x.asTenant(() => ChatSessionLease.acquire())]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const lease = results.find(r => r.status === "fulfilled")!.value;
  try {
    auth(lease); await lease.sync();
    await x.db.query("UPDATE chatgpt_sessions SET lease_until=now()-interval '1 second' WHERE user_id=$1", [x.owner]);
    const next = await x.asTenant(() => ChatSessionLease.acquire());
    try { auth(lease, "stale-secret"); await assert.rejects(lease.sync(), /revogada|expirou/); await lease.dispose(); await next.sync(); }
    finally { await next.dispose(); }
    assert.ok(!(await x.asTenant(readChatSession)).state.auth?.includes("stale-secret"));
  } finally { await lease.dispose(); }
});

test("logout revoga leases de outros processos e impede restauração do segredo", async t => {
  const x = await setup(t), lease = await x.asTenant(() => ChatSessionLease.acquire());
  try {
    auth(lease); await lease.sync();
    await x.asTenant(revokeChatSession);
    await assert.rejects(lease.sync(true), /revogada|expirou/);
    assert.equal((await x.asTenant(readChatSession)).state.auth, null);
    const next = await x.asTenant(() => ChatSessionLease.acquire());
    try { assert.equal(existsSync(join(next.directory, "auth.json")), false); }
    finally { await next.dispose(); }
  } finally { await lease.dispose(); }
});

test("ciphertext trocado entre contas, arquivo simbólico e arquivo grande são recusados", async t => {
  const x = await setup(t), a = await x.asTenant(() => ChatSessionLease.acquire()), b = await x.asB(() => ChatSessionLease.acquire());
  try {
    auth(a); await a.sync(true);
    await x.db.query("UPDATE chatgpt_sessions SET ciphertext=(SELECT ciphertext FROM chatgpt_sessions WHERE user_id=$1) WHERE user_id=$2", [x.owner, x.ownerB]);
    await assert.rejects(x.asB(readChatSession));
    symlinkSync(join(a.directory, "auth.json"), join(b.directory, "auth.json"));
    await assert.rejects(b.sync(), /inválido/); unlinkSync(join(b.directory, "auth.json"));
    writeFileSync(join(b.directory, "auth.json"), "x".repeat(65537));
    await assert.rejects(b.sync(), /inválido/);
  } finally { await a.dispose(); await b.dispose(); }
});

test("suspensão impede o processo nativo de renovar ou persistir a sessão", async t => {
  const x = await setup(t), lease = await x.asTenant(() => ChatSessionLease.acquire());
  try {
    auth(lease); await lease.sync();
    await x.db.query("UPDATE users SET beta_status='blocked' WHERE id=$1", [x.owner]);
    await assert.rejects(lease.sync(), /revogada|expirou/);
  } finally { await lease.dispose(); }
});

test("login sobrevive ao fim do request, outro bridge restaura e nenhum token chega ao status", async t => {
  const x = await setup(t), directories: string[] = [];
  const launch = (options: { env: NodeJS.ProcessEnv; cwd: string }) => {
    directories.push(options.env.CODEX_HOME!);
    assert.equal(options.env.DATABASE_URL, undefined); assert.equal(options.env.CHAVE_MESTRA, undefined);
    return spawn(process.execPath, [join(process.cwd(), "scripts/fixtures/codex-protocol.mjs")], { ...options, stdio: "pipe" });
  };
  const first = await x.asTenant(() => new ChatGPTBridge(launch)), second = await x.asTenant(() => new ChatGPTBridge(launch));
  try {
    await x.asTenant(() => first.beginLogin());
    for (let i = 0; i < 100; i++) {
      const saved = await x.asTenant(readChatSession);
      if (saved.state.account && !saved.busy) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await first.close();
    const status = await x.asTenant(() => second.account());
    assert.equal(status.account?.email, "test@example.com");
    assert.ok(!JSON.stringify(status).includes("fixture-access"));
    assert.equal(await x.asTenant(() => second.run({ system: "", prompt: "Olá" })), "Olá mundo");
    assert.ok(directories.every(dir => !existsSync(dir)));
    await x.asB(async () => assert.rejects(second.account(), /outra conta/));
    await x.asTenant(() => second.logout());
    assert.equal((await x.asTenant(readChatSession)).state.auth, null);
  } finally { await first.close(); await second.close(); }
});

test("revogação em outro processo interrompe turno ativo e não ressuscita a sessão", async t => {
  const x = await setup(t);
  const bridge = await x.asTenant(() => new ChatGPTBridge(options => spawn(process.execPath, [join(process.cwd(), "scripts/fixtures/codex-protocol.mjs")], { ...options, stdio: "pipe" })));
  try {
    await x.asTenant(() => bridge.beginLogin());
    for (let i = 0; i < 100; i++) { if (!(await x.asTenant(readChatSession)).busy) break; await new Promise(r => setTimeout(r, 10)); }
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = x.asTenant(() => bridge.run({ system: "", prompt: "wait", timeoutMs: 15000, onText: started }));
    const rejected = assert.rejects(pending, /encerrada|revogada|expirou/);
    await ready;
    await x.asTenant(revokeChatSession);
    await rejected;
    assert.equal((await x.asTenant(readChatSession)).state.auth, null);
  } finally { await bridge.close(); }
});

test("parada forçada encerra launcher e filho nativo antes de remover o temporário", async t => {
  if (process.platform === "win32") { t.skip("Process groups are POSIX-only"); return; }
  const x = await setup(t), fixture = join(data, "stubborn-launcher.mjs");
  writeFileSync(fixture, `
    import { spawn } from 'node:child_process';
    import { createInterface } from 'node:readline';
    import { writeFileSync } from 'node:fs';
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"], { stdio: ['ignore','ignore','ignore','ipc'] });
    child.once('message', () => {
      writeFileSync(process.env.CODEX_HOME + '/child.pid', String(child.pid));
      createInterface({input:process.stdin}).on('line', line => {
        const m = JSON.parse(line);
        if (m.id) process.stdout.write(JSON.stringify({id:m.id,result:m.method==='account/read'?{account:null}:{}})+'\\n');
      });
    });
  `);
  let directory = "";
  const bridge = await x.asTenant(() => new ChatGPTBridge(options => { directory = options.env.CODEX_HOME!; return spawn(process.execPath, [fixture], { ...options, stdio: "pipe" }); }));
  try {
    const done = assert.rejects(x.asTenant(() => bridge.usage()), /Conecte sua conta/);
    for (let i = 0; i < 200 && (!directory || !existsSync(join(directory, "child.pid"))); i++) await new Promise(r => setTimeout(r, 10));
    const pid = Number(readFileSync(join(directory, "child.pid"), "utf8"));
    await done;
    assert.equal(existsSync(directory), false);
    let alive = true;
    for (let i = 0; i < 100; i++) {
      try { process.kill(pid, 0); } catch { alive = false; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(alive, false, "native child survived forced shutdown");
  } finally { await bridge.close(); }
});
