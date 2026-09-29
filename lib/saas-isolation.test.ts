import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createTestDatabase } from "../scripts/saas-test-db";
import { migrateDatabase } from "./db/migrate";
import { hashToken, randomToken, unseal } from "./saas-security";
import { currentTenant, tenantId, withTenantSession, withTenantJob } from "./tenant-context";
import { privateDataDirectory } from "./tenant-files";
import { tenantConfig, setTenantConfig, allTenantConfig } from "./tenant-config";
import { getConfig, setConfig, configTransaction } from "./store";
import { saveToolCredential, listToolCredentials, getToolCredential, deleteToolCredential, withToolCredential } from "./tool-credential-store";
import { toolConfig } from "./tool-config-context";
import { beginIntegrationOAuth, consumeIntegrationOAuth } from "./tenant-oauth";
import { enviarPorOutlook, limparCache } from "./email-envio";
import * as attachments from "./attachment-service";
import { vectorCollection, vectorStorageLocation } from "./knowledge-vectors";
import { createTenantFlow, getTenantFlow, listTenantFlows, saveTenantFlow, deleteTenantFlow, publishTenantFlow, getTenantRun, listTenantRuns, putTenantRun, claimTenantRun, tenantRunPage } from "./tenant-flows";
import { authAction, tenantApi, tenantJsonStream } from "./saas-http";
import { ChatGPTBridge, chatGPT } from "./chatgpt";
import { filePath } from "./tool-services";
import { template, block, type Run } from "./flow-types";
import { startRun, resumeRun, cancelRun } from "./flow-runtime";
import { tenantConversationHistory } from "./conversation";
import { callTool } from "./tools";

const testDb = await createTestDatabase();
const { db } = testDb;
const dir = mkdtempSync(join(tmpdir(), "saas-isolation-"));
process.env.DATA_DIR = dir;
process.env.CHAVE_MESTRA = randomBytes(32).toString("base64");
process.env.APP_URL = "https://app.example.com";
const a = randomUUID(), b = randomUUID(), pending = randomUUID();
const tokenA = randomToken(), tokenB = randomToken(), tokenPending = randomToken();
const asA = <T>(action: () => T | Promise<T>) => withTenantSession(db, tokenA, action);
const asB = <T>(action: () => T | Promise<T>) => withTenantSession(db, tokenB, action);
const mutation = (data: unknown, token = tokenA) => new Request("https://app.example.com/api/flows", {
  method: "POST", headers: { "Content-Type": "application/json", origin: "https://app.example.com", cookie: `agentflows_session=${token}` }, body: JSON.stringify(data),
});
test.before(async () => { await migrateDatabase(db); await migrateDatabase(db); });
test.after(async () => { await testDb.close(); rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(async () => {
  await testDb.exec("TRUNCATE users,invites,rate_limits,mail_outbox,oauth_states CASCADE");
  for (const [id, token, status] of [[a, tokenA, "approved"], [b, tokenB, "approved"], [pending, tokenPending, "pending"]]) {
    await db.query("INSERT INTO users(id,name,email,email_verified_at,beta_status) VALUES ($1,$2,$3,now(),$4)", [id, `User ${id}`, `${id}@example.com`, status]);
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 day')", [hashToken(token), id]);
  }
});

test("contexto exige sessão aprovada, propaga em awaits e não pode escapar nem trocar de dono", async () => {
  assert.throws(currentTenant, /ausente/);
  await assert.rejects(withTenantSession(db, undefined, () => "secret"), /Entre/);
  await assert.rejects(withTenantSession(db, tokenPending, () => "secret"), /Aguarde/);
  let late!: () => string | undefined;
  await Promise.all([asA(async () => {
    assert.equal(tenantId(), a);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(tenantId(), a);
    late = AsyncLocalStorage.bind(tenantId);
    await assert.rejects(asB(() => "wrong-owner"), /trocar/);
  }), asB(async () => { await Promise.resolve(); assert.equal(tenantId(), b); })]);
  assert.throws(late, /encerrado/);
  await db.query("UPDATE users SET beta_status='blocked' WHERE id=$1", [a]);
  await assert.rejects(asA(() => "blocked"), /suspenso/);
  await assert.rejects(withTenantJob(db, a, () => "blocked-worker"), /suspenso/);
  await withTenantJob(db, b, () => assert.equal(tenantId(), b));
});

test("configuração não herda ambiente ou SQLite; leitura, atualização e remoção só afetam o dono", async () => {
  process.env.OPENROUTER_API_KEY = "operator-secret";
  try {
    await asA(async () => {
      assert.equal(await tenantConfig("OPENROUTER_API_KEY"), undefined);
      assert.equal(getConfig("OPENROUTER_API_KEY"), undefined);
      await setTenantConfig("OPENROUTER_API_KEY", "secret-a");
      assert.deepEqual(await allTenantConfig(), { OPENROUTER_API_KEY: "secret-a" });
    });
    await asB(async () => {
      assert.deepEqual(await allTenantConfig(), {});
      await setTenantConfig("OPENROUTER_API_KEY", "secret-b");
      await setTenantConfig("OPENROUTER_API_KEY", null);
    });
    await asA(async () => assert.equal(await tenantConfig("OPENROUTER_API_KEY"), "secret-a"));
    assert.ok(!(await db.query("SELECT ciphertext FROM credentials")).rows[0].ciphertext.includes("secret-a"));
  } finally { delete process.env.OPENROUTER_API_KEY; }
});

test("fluxos: listar, ler, salvar, publicar e excluir não expõem nem alteram outra conta", async () => {
  const flow = await asA(() => createTenantFlow("Conta A", false, { name: "Conta A", description: "private", graph: template() }));
  await asB(async () => {
    assert.deepEqual(await listTenantFlows(), []);
    for (const action of [() => getTenantFlow(flow.id), () => saveTenantFlow(flow.id, {}), () => publishTenantFlow(flow.id), () => deleteTenantFlow(flow.id)]) {
      await assert.rejects(action(), (error: unknown) => (error as { status: number }).status === 404);
    }
    await createTenantFlow("Conta B");
  });
  await asA(async () => {
    assert.deepEqual((await listTenantFlows()).map((f) => f.name), ["Conta A"]);
    assert.equal((await publishTenantFlow(flow.id)).published?.nodes.length, 3);
    await saveTenantFlow(flow.id, { name: "A atualizado", description: "", graph: template() });
    assert.equal((await getTenantFlow(flow.id)).name, "A atualizado");
  });
  await asB(async () => assert.deepEqual((await listTenantFlows()).map((f) => f.name), ["Conta B"]));
});

test("configurações: rollback de erro, savepoint e conflito concorrente não deixam escrita parcial", async () => {
  await asA(() => setConfig("SHARED", "initial"));
  await assert.rejects(asA(() => { setConfig("SHARED", "discard"); throw new Error("abort"); }), /abort/);
  await asA(() => { setConfig("SHARED", "discard-response"); return new Response(null, { status: 400 }); });
  await asA(() => {
    assert.equal(getConfig("SHARED"), "initial");
    assert.throws(() => configTransaction(() => { setConfig("SHARED", "discard-savepoint"); throw new Error("abort"); }), /abort/);
    assert.equal(getConfig("SHARED"), "initial");
  });
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const loaded = new Promise<void>((resolve) => { ready = resolve; });
  const stale = asA(async () => {
    setConfig("A_PARTIAL", "must rollback"); setConfig("SHARED", "stale"); ready(); await gate;
  });
  await loaded;
  await asA(() => setConfig("SHARED", "winner"));
  release();
  await assert.rejects(stale, (error: unknown) => (error as { status: number }).status === 409);
  await asA(() => { assert.equal(getConfig("SHARED"), "winner"); assert.equal(getConfig("A_PARTIAL"), undefined); });
  await Promise.all([asA(() => setConfig("SEPARATE_A", "a")), asA(() => setConfig("SEPARATE_B", "b"))]);
  await asA(() => { assert.equal(getConfig("SEPARATE_A"), "a"); assert.equal(getConfig("SEPARATE_B"), "b"); });
});

test("credenciais de ferramentas: isolamento, resumo sem segredo e proteção de rascunho/publicação", async () => {
  const input = { name: "Pesquisa", provider: "tavily", fields: { TOOL_TAVILY_KEY: "secret-a" } };
  const credential = await asA(() => saveToolCredential(input));
  assert.ok(!JSON.stringify(credential).includes("secret-a"));
  let late!: () => string | undefined;
  await asA(() => withToolCredential(credential.id, "tavily", () => {
    assert.equal(toolConfig("TOOL_TAVILY_KEY"), "secret-a");
    late = AsyncLocalStorage.bind(() => toolConfig("TOOL_TAVILY_KEY"));
  }));
  assert.throws(late, /encerrado/);
  await asB(() => {
    assert.deepEqual(listToolCredentials(), []);
    for (const action of [() => getToolCredential(credential.id), () => saveToolCredential(input, credential.id), () => deleteToolCredential(credential.id)])
      assert.throws(action, (error: unknown) => (error as { status: number }).status === 404);
  });
  const graph = template();
  graph.nodes[1].data.config.tools = "interno:tavily";
  graph.nodes[1].data.config.toolCards = JSON.stringify([{ id: "search", kind: "tool", target: "interno:tavily", credentialId: credential.id }]);
  await assert.rejects(asB(() => createTenantFlow("Foreign", false, { name: "Foreign", description: "", graph })), /Credencial não encontrada/);
  const flow = await asA(() => createTenantFlow("Mine", false, { name: "Mine", description: "", graph }));
  await assert.rejects(asA(() => deleteToolCredential(credential.id)), /em uso/);
  await asA(() => publishTenantFlow(flow.id));
  await asA(() => saveTenantFlow(flow.id, { name: "Mine", description: "", graph: template() }));
  // An imported version may retain a publication different from its draft.
  await db.query("UPDATE flows SET body=jsonb_set(body,'{published}',$3::jsonb) WHERE user_id=$1 AND id=$2", [a, flow.id, JSON.stringify(graph)]);
  await assert.rejects(asA(() => deleteToolCredential(credential.id)), /em uso/);
  await asA(() => publishTenantFlow(flow.id, false));
  await asA(() => deleteToolCredential(credential.id));
  await asA(() => assert.deepEqual(listToolCredentials(), []));
});

test("fluxos rejeitam referências a bases de conhecimento de outra conta", async () => {
  await db.query("INSERT INTO knowledge_bases(user_id,id,body) VALUES ($1,'private-base',$2)", [a, JSON.stringify({ id: "private-base" })]);
  const graph = template(); graph.nodes[1].data.config.knowledgeBase = "private-base";
  await assert.rejects(asB(() => createTenantFlow("Foreign KB", false, { name: "Foreign KB", description: "", graph })), /Base de conhecimento não encontrada/);
  await asA(() => createTenantFlow("My KB", false, { name: "My KB", description: "", graph }));
});

test("OAuth de integrações vincula conta, endpoint e navegador, expira e é de uso único", async () => {
  const verifier = randomToken(), provider = "mcp:CRM:https://crm.example.com";
  const state = await asA(() => beginIntegrationOAuth(provider, verifier));
  await assert.rejects(asB(() => consumeIntegrationOAuth(provider, state, verifier)), /outra conexão ou conta/);
  await assert.rejects(asA(() => consumeIntegrationOAuth("mcp:CRM:https://evil.example", state, verifier)), /outra conexão ou conta/);
  await assert.rejects(asA(() => consumeIntegrationOAuth(provider, state, randomToken())), /expirada/);
  await asA(() => consumeIntegrationOAuth(provider, state, verifier));
  await assert.rejects(asA(() => consumeIntegrationOAuth(provider, state, verifier)), /expirada/);
  const expired = await asA(() => beginIntegrationOAuth(provider, verifier));
  await db.query("UPDATE oauth_states SET expires_at=now()-interval '1 minute' WHERE state_hash=$1", [hashToken(expired)]);
  await assert.rejects(asA(() => consumeIntegrationOAuth(provider, expired, verifier)), /expirada/);
});

test("e-mail: cache de token e rotação são privados mesmo com refresh igual e variável global", async () => {
  const originalFetch = globalThis.fetch;
  const names = ["MICROSOFT_CLIENT_ID_APP", "MICROSOFT_CLIENT_SECRET_APP", "OUTLOOK_REFRESH_TOKEN"];
  const originalEnv = names.map((name) => process.env[name]);
  names.forEach((name) => { process.env[name] = "operator-value"; });
  let exchanges = 0;
  const sent: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/token")) {
      exchanges++;
      return Response.json({ access_token: `access-${tenantId()}`, refresh_token: "rotated-shared", expires_in: 3600 });
    }
    sent.push(new Headers(init?.headers).get("authorization")!);
    return new Response(null, { status: 202 });
  };
  try {
    await asA(() => { limparCache(); setConfig("OUTLOOK_REFRESH_TOKEN", "shared-refresh"); });
    await asB(() => { limparCache(); setConfig("OUTLOOK_REFRESH_TOKEN", "shared-refresh"); });
    const send = () => enviarPorOutlook("recipient@example.com", "Hello", "Private mail");
    await asA(send); await asB(send); await asA(send); await asB(send);
    assert.equal(exchanges, 2);
    assert.deepEqual(sent, [`Bearer access-${a}`, `Bearer access-${b}`, `Bearer access-${a}`, `Bearer access-${b}`]);
    await asA(() => { assert.equal(getConfig("OUTLOOK_REFRESH_TOKEN"), "rotated-shared"); limparCache(); });
    await asB(send);
    assert.equal(exchanges, 2, "limpar A não invalida B");
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
  }
});

test("execuções: FKs compostas, paginação, aprovação única e exclusão impedida enquanto pendente", async () => {
  const flow = await asA(() => createTenantFlow("A"));
  const now = new Date().toISOString();
  const run: Run = { id: randomUUID(), flowId: flow.id, name: "Run A", version: 1, status: "waiting", demo: true,
    input: "private input", output: "secret output", graph: template(), next: null, state: {}, outputs: {}, visits: {}, trace: [], createdAt: now, updatedAt: now };
  await asB(async () => {
    await assert.rejects(putTenantRun(run), /não encontrado/);
    assert.deepEqual(await listTenantRuns(), []);
  });
  // Even bypassing the repository cannot link B's run to A's flow.
  await assert.rejects(db.query("INSERT INTO runs(user_id,id,flow_id,status,body) VALUES ($1,$2,$3,$4,$5)", [b, run.id, flow.id, run.status, JSON.stringify(run)]), /foreign key/);
  await asA(async () => {
    await putTenantRun(run);
    await assert.rejects(deleteTenantFlow(flow.id), /Finalize/);
    const page = await tenantRunPage({ pageSize: 10 });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].input, "private input");
    assert.ok(!Object.hasOwn(page.items[0], "output"));
    assert.equal((await claimTenantRun(run.id)).status, "running");
    await assert.rejects(claimTenantRun(run.id), /decisão/);
  });
  await asB(async () => {
    assert.equal((await tenantRunPage()).total, 0);
    await assert.rejects(getTenantRun(run.id), /não encontrada/);
    await assert.rejects(claimTenantRun(run.id), /não encontrada/);
    await assert.rejects(listTenantRuns(flow.id), /não encontrado/);
  });
});

test("bases, fontes, fragmentos e anexos não aceitam pais de outra conta no PostgreSQL", async () => {
  await db.query("INSERT INTO knowledge_bases(user_id,id,body) VALUES ($1,'base',$2)", [a, JSON.stringify({ id: "base" })]);
  await assert.rejects(db.query("INSERT INTO knowledge_sources(user_id,base_id,id,body) VALUES ($1,'base','source',$2)", [b, JSON.stringify({ id: "source", baseId: "base" })]), /foreign key/);
  await db.query("INSERT INTO knowledge_sources(user_id,base_id,id,body) VALUES ($1,'base','source',$2)", [a, JSON.stringify({ id: "source", baseId: "base" })]);
  await assert.rejects(db.query("INSERT INTO knowledge_chunks(user_id,base_id,source_id,id,body) VALUES ($1,'base','source','chunk',$2)", [b, JSON.stringify({ id: "chunk", sourceId: "source" })]), /foreign key/);
  const flow = await asA(() => createTenantFlow());
  await assert.rejects(db.query("INSERT INTO attachments(user_id,id,flow_id,body) VALUES ($1,'attachment',$2,$3)", [b, flow.id, JSON.stringify({ id: "attachment", flowId: flow.id })]), /foreign key/);
});

test("anexos: upload, bytes, contexto, marcação e exclusão respeitam usuário e fluxo", async () => {
  const flowA = await asA(() => createTenantFlow("Files A"));
  const otherA = await asA(() => createTenantFlow("Other A"));
  const flowB = await asB(() => createTenantFlow("Files B"));
  const file = new File(["Documento privado de A"], "nota.txt");
  await assert.rejects(asB(() => attachments.saveAttachment(flowA.id, file)), /não encontrado/);
  const uploaded = await asA(() => attachments.saveAttachment(flowA.id, file));
  await asB(async () => {
    await assert.rejects(attachments.getAttachment(uploaded.id), /não encontrado/);
    await assert.rejects(attachments.attachmentBytes(uploaded.id), /não encontrado/);
    await assert.rejects(attachments.resolveAttachments(flowB.id, [uploaded.id]), /não encontrado/);
    await assert.rejects(attachments.markAttachmentsUsed([uploaded]), /não encontrado/);
  });
  await asA(async () => {
    assert.equal((await attachments.attachmentBytes(uploaded.id)).toString(), "Documento privado de A");
    assert.match((await attachments.attachmentContext(flowA.id, [uploaded])).text, /Documento privado de A/);
    await assert.rejects(attachments.resolveAttachments(otherA.id, [uploaded.id]), /outro fluxo/);
    await attachments.markAttachmentsUsed([uploaded]);
  });
  const used = await db.query<{ used: boolean }>("SELECT used FROM attachments WHERE user_id=$1 AND id=$2", [a, uploaded.id]);
  assert.equal(used.rows[0].used, true);
  await asB(() => attachments.saveAttachment(flowB.id, new File(["Only B"], "b.txt")));
  await asA(() => deleteTenantFlow(flowA.id));
  await asA(async () => assert.rejects(attachments.attachmentBytes(uploaded.id), /não encontrado/));
  assert.equal((await db.query("SELECT id FROM attachment_blobs WHERE user_id=$1", [a])).rows.length, 0);
  assert.equal((await db.query("SELECT id FROM attachment_blobs WHERE user_id=$1", [b])).rows.length, 1);
});

test("anexos: expiração remove só abandonados do dono e gravação composta faz rollback", async () => {
  const flow = await asA(() => createTenantFlow("A"));
  const flowB = await asB(() => createTenantFlow("B"));
  const file = () => new File(["note"], "note.txt");
  const oldA = await asA(() => attachments.saveAttachment(flow.id, file()));
  const usedA = await asA(() => attachments.saveAttachment(flow.id, file()));
  const oldB = await asB(() => attachments.saveAttachment(flowB.id, file()));
  await asA(() => attachments.markAttachmentsUsed([usedA]));
  await db.query("UPDATE attachments SET created_at=now()-interval '2 days'");
  const newA = await asA(() => attachments.saveAttachment(flow.id, file()));
  await asA(async () => {
    await assert.rejects(attachments.getAttachment(oldA.id), /não encontrado/);
    assert.equal((await attachments.getAttachment(usedA.id)).id, usedA.id);
    await assert.rejects(attachments.markAttachmentsUsed([newA, { ...newA, id: randomUUID() }]), /não encontrado/);
  });
  await asB(async () => assert.equal((await attachments.getAttachment(oldB.id)).id, oldB.id));
  assert.equal((await db.query("SELECT used FROM attachments WHERE user_id=$1 AND id=$2", [a, newA.id])).rows[0].used, false);
  assert.equal((await db.query("SELECT id FROM attachment_blobs WHERE user_id=$1", [a])).rows.length, 2);
});

test("anexos: quota é por usuário e rejeição não deixa metadados nem bytes parciais", async () => {
  const flow = await asA(() => createTenantFlow("A quota"));
  await db.query(`INSERT INTO attachments(user_id,id,flow_id,body)
    SELECT $1,'quota-'||i,$2,jsonb_build_object('id','quota-'||i,'flowId',$2::text) FROM generate_series(1,2000) i`, [a, flow.id]);
  await db.query("INSERT INTO attachment_blobs(user_id,id,data) SELECT user_id,id,decode('41','hex') FROM attachments WHERE user_id=$1", [a]);
  await assert.rejects(asA(() => attachments.saveAttachment(flow.id, new File(["one"], "note.txt"))), (error: unknown) => (error as { status: number }).status === 413);
  assert.equal((await db.query("SELECT count(*)::int n FROM attachments WHERE user_id=$1", [a])).rows[0].n, 2000);
  assert.equal((await db.query("SELECT count(*)::int n FROM attachment_blobs WHERE user_id=$1", [a])).rows[0].n, 2000);
  const other = await asB(() => createTenantFlow("B capacity"));
  await asB(() => attachments.saveAttachment(other.id, new File(["allowed"], "note.txt")));
});

test("arquivos de ferramentas, ChatGPT e índices FAISS têm namespaces privados e rejeitam symlinks", async () => {
  const scope = { baseId: "same-base", generation: "same-generation", dimensions: 2 };
  const pathA = await asA(() => {
    const file = filePath("same.txt"); writeFileSync(file, "Only A"); return file;
  });
  const pathB = await asB(() => {
    const file = filePath("same.txt"); writeFileSync(file, "Only B"); return file;
  });
  assert.notEqual(pathA, pathB);
  assert.equal(await asA(() => readFileSync(filePath("same.txt"), "utf8")), "Only A");
  assert.equal(await asB(() => readFileSync(filePath("same.txt"), "utf8")), "Only B");
  assert.notEqual(await asA(() => vectorCollection(scope)), await asB(() => vectorCollection(scope)));
  assert.notEqual((await asA(() => vectorStorageLocation({ provider: "faiss", url: "" }, scope)))?.location,
    (await asB(() => vectorStorageLocation({ provider: "faiss", url: "" }, scope)))?.location);
  const aRoot = await asA(() => privateDataDirectory("chatgpt"));
  const bRoot = await asB(() => privateDataDirectory());
  symlinkSync(aRoot, join(bRoot, "leak"));
  await asB(() => {
    assert.throws(() => privateDataDirectory("leak"), /inseguro/);
    assert.throws(() => privateDataDirectory(".."), /inválido/);
    assert.throws(() => filePath(`../../${a}/tool-files/same.txt`), /relativo/);
  });
});

test("ChatGPT reutiliza apenas a conexão do dono e ferramentas herdam o contexto do turno atual", async () => {
  const launch = (options: { env: NodeJS.ProcessEnv; cwd: string }) => spawn(process.execPath, [join(process.cwd(), "scripts/fixtures/codex-protocol.mjs")], { ...options, stdio: "pipe" });
  const bridgeA = await asA(() => new ChatGPTBridge(launch));
  const bridgeB = await asB(() => new ChatGPTBridge(launch));
  try {
    await asA(() => bridgeA.beginLogin());
    await asB(() => bridgeB.beginLogin());
    await asB(async () => assert.rejects(bridgeA.account(), /outra conta/));
    await asA(async () => {
      const scope = currentTenant();
      const result = await bridgeA.run({ system: "", prompt: "buscar", tools: [{ name: "buscar", description: "", schema: {}, call: async () => {
        assert.equal(currentTenant(), scope);
        assert.equal(tenantId(), a);
        return "A private result";
      } }] });
      assert.equal(result, "Resposta com ferramenta");
    });
    assert.notEqual(await asA(chatGPT), await asB(chatGPT));
    assert.equal(await asA(chatGPT), await asA(chatGPT));
  } finally { await bridgeA.close(); await bridgeB.close(); }
});

test("HTTP ignora owner forjado, aplica beta, CSRF, corpo limitado e respostas privadas", async () => {
  const flow = await asB(() => createTenantFlow("B private"));
  const forged = mutation({ user_id: b });
  forged.headers.set("x-user-id", b);
  const response = await tenantApi(forged, () => getTenantFlow(flow.id), db);
  assert.equal(response.status, 404);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal((await tenantApi(mutation({}, tokenPending), () => "secret", db)).status, 403);
  assert.equal((await tenantApi(mutation({}, "invalid"), () => "secret", db)).status, 401);
  const evil = mutation({}); evil.headers.set("origin", "https://evil.example");
  assert.equal((await authAction(db, evil, "logout")).status, 403);
  assert.equal((await authAction(db, mutation({ name: "x".repeat(17000) }), "register")).status, 413);
  const session = await authAction(db, new Request("https://app.example.com/api/auth/session", { headers: { cookie: `agentflows_session=${tokenA}` } }), "session");
  assert.equal((await session.json()).user.id, a);
  const logout = await authAction(db, mutation({}), "logout");
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie")!, /HttpOnly.*Max-Age=0.*Secure/);
  assert.equal((await tenantApi(mutation({}), () => "secret", db)).status, 401);
});

test("jornada HTTP: cadastro, login pendente, confirmação, convite e recuperação revogam sessão corretamente", async () => {
  const email = "journey@example.com", password = "Senha-Segura-2026!";
  const registered = await authAction(db, mutation({ name: "Jornada", email, password, confirmPassword: password }, ""), "register");
  assert.equal(registered.status, 202);
  assert.equal(registered.headers.get("set-cookie"), null);
  const login = await authAction(db, mutation({ email, password }, ""), "login");
  assert.equal(login.status, 200);
  const token = login.headers.get("set-cookie")!.match(/agentflows_session=([^;]+)/)![1];
  assert.equal((await login.json()).user.beta_status, "pending");
  assert.equal((await tenantApi(mutation({}, token), listTenantFlows, db)).status, 403);
  async function emailToken() {
    const rows = (await db.query<{ id: string; payload_ciphertext: string }>("SELECT id,payload_ciphertext FROM mail_outbox ORDER BY created_at DESC")).rows;
    const mail = JSON.parse(unseal(rows[0].payload_ciphertext, `mail:${rows[0].id}`));
    assert.equal(mail.to, email);
    return new URLSearchParams(new URL(mail.text.match(/https:\/\/\S+/)[0]).hash.slice(1)).get("token");
  }
  assert.equal((await authAction(db, mutation({ token: await emailToken() }, token), "verify-email")).status, 200);
  await db.query("INSERT INTO invites(id,code_hash,max_uses) VALUES ($1,$2,1)", [randomUUID(), hashToken("journey-invite")]);
  assert.equal((await authAction(db, mutation({ code: "journey-invite" }, token), "invite")).status, 200);
  const create = await tenantApi(mutation({ user_id: a }, token), () => createTenantFlow("Meu primeiro fluxo"), db);
  assert.equal(create.status, 200);
  const flow = await create.json();
  await asA(async () => assert.rejects(getTenantFlow(flow.id), /não encontrado/));
  assert.equal((await authAction(db, mutation({ email }), "forgot-password")).status, 202);
  assert.equal((await authAction(db, mutation({ token: await emailToken(), password: "Nova-Senha-2026!" }), "reset-password")).status, 200);
  assert.equal((await tenantApi(mutation({}, token), listTenantFlows, db)).status, 401);
  const newLogin = await authAction(db, mutation({ email, password: "Nova-Senha-2026!" }), "login");
  assert.equal(newLogin.status, 200);
  assert.equal((await newLogin.json()).user.beta_status, "approved");
});

test("sem contexto não há acesso mesmo sem DATABASE_URL", async () => {
  const oldUrl = process.env.DATABASE_URL;
  try {
    for (const url of [undefined, "postgres://configured"]) {
      if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
      assert.throws(() => getConfig("OPENROUTER_API_KEY"), /ausente/);
      assert.throws(() => setConfig("OPENROUTER_API_KEY", "secret"), /ausente/);
      assert.throws(() => privateDataDirectory(), /ausente/);
      assert.throws(chatGPT, /ausente/);
      assert.throws(listToolCredentials, /ausente/);
      await assert.rejects(createTenantFlow("Sem usuário"), /ausente/);
      await assert.rejects(attachments.markAttachmentsUsed([]), /ausente/);
      const { listKnowledgeBases } = await import("./knowledge-service");
      await assert.rejects(listKnowledgeBases(), /ausente/);
    }
  } finally {
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  }
});

test("motor SaaS: execução, aprovação única, histórico e cancelamento pertencem ao dono", async () => {
  const graph = template();
  graph.nodes[1] = block("approval", "analista", 0, 0);
  graph.edges[1].sourceHandle = "yes";
  graph.nodes.push(block("end", "rejeitada", 0, 0)); graph.nodes[3].data.config.text = "Não aprovado";
  graph.edges.push({ id: "no", source: "analista", target: "rejeitada", sourceHandle: "no" });
  const flow = await asA(() => createTenantFlow("Approval A", false, { name: "Approval A", description: "", graph }));
  const run = await asA(() => startRun(flow.id, "Segredo A", false, true));
  assert.equal(run.status, "waiting");
  await asB(async () => {
    await assert.rejects(startRun(flow.id, "B", false, true), /não encontrado/);
    await assert.rejects(resumeRun(run.id, "yes"), /não encontrada/);
    await assert.rejects(cancelRun(run.id), /não encontrada/);
    await assert.rejects(tenantConversationHistory(flow.id, [run.id]), /não encontrada/);
  });
  const decisions = await Promise.allSettled([asA(() => resumeRun(run.id, "yes")), asA(() => resumeRun(run.id, "no"))]);
  assert.equal(decisions.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await asA(() => getTenantRun(run.id))).status, "completed");
  const waiting = await asA(() => startRun(flow.id, "Outro", false, true));
  await asA(() => cancelRun(waiting.id));
  const stale = { ...waiting, status: "running" as const };
  assert.equal((await asA(() => putTenantRun(stale))).status, "cancelled");
  assert.equal((await asA(() => getTenantRun(waiting.id))).status, "cancelled");
});

test("agente SaaS usa credenciais/contexto próprios, continua conversa e só chama subfluxos do dono", async () => {
  const graph = template();
  const flow = await asA(() => createTenantFlow("Parent", false, { name: "Parent", description: "", graph }));
  const foreign = await asB(() => createTenantFlow("Foreign", false, { name: "Foreign", description: "", graph }));
  const bridge = await asA(chatGPT), account = bridge.account, runner = bridge.run;
  bridge.account = async () => ({ account: { type: "chatgpt" }, login: null, error: null });
  let calls = 0;
  bridge.run = async ({ prompt, onText }) => {
    assert.equal(tenantId(), a);
    calls++; onText?.("Resposta parcial");
    if (calls === 2) assert.match(prompt, /Resposta privada A/);
    return "Resposta privada A";
  };
  try {
    const first = await asA(() => startRun(flow.id, "Primeira pergunta"));
    assert.equal(first.status, "completed");
    const second = await asA(() => startRun(flow.id, "Continuação", false, false, [], [first.id]));
    assert.equal(second.conversation?.[0].output, "Resposta privada A");
    await assert.rejects(asB(() => tenantConversationHistory(foreign.id, [first.id])), /não encontrada/);
    await asA(async () => {
      await assert.rejects(callTool("interno:executar_fluxo", { fluxo: foreign.id, entrada: "secret" }), /não encontrado/);
      const result = JSON.parse(await callTool("interno:executar_fluxo", { fluxo: flow.id, entrada: "Subfluxo" }));
      assert.equal(result.status, "completed");
      assert.equal((await getTenantRun(result.id)).flowId, flow.id);
    });
  } finally { bridge.account = account; bridge.run = runner; }
});

test("cancelar agente SaaS interrompe chamada e gravação tardia não ressuscita execução", async () => {
  const flow = await asA(() => createTenantFlow("Cancel A", false, { name: "Cancel A", description: "", graph: template() }));
  const bridge = await asA(chatGPT), account = bridge.account, runner = bridge.run;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  bridge.account = async () => ({ account: { type: "chatgpt" }, login: null, error: null });
  bridge.run = ({ signal }) => new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("Cancelled upstream")), { once: true }); ready();
  });
  try {
    const work = asA(() => startRun(flow.id, "Trabalho longo"));
    await started;
    const run = (await asA(() => listTenantRuns(flow.id)))[0];
    await assert.rejects(asB(() => cancelRun(run.id)), /não encontrada/);
    await asA(() => cancelRun(run.id));
    assert.equal((await work).status, "cancelled");
    assert.equal((await asA(() => getTenantRun(run.id))).status, "cancelled");
  } finally { bridge.account = account; bridge.run = runner; }
});

test("stream SaaS mantém contexto até o fim, confirma credenciais antes do resultado e aborta no cancelamento", async () => {
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let escaped!: () => string | undefined;
  const response = await tenantJsonStream(mutation({}), async (emit) => {
    assert.equal(tenantId(), a); setConfig("STREAM_KEY", "private-a");
    escaped = AsyncLocalStorage.bind(() => getConfig("STREAM_KEY"));
    emit({ phase: "planning" }); ready(); await gate;
    assert.equal(getConfig("STREAM_KEY"), "private-a");
    return { name: "Generated flow" };
  }, db);
  await started;
  assert.match(response.headers.get("cache-control")!, /no-store/);
  await asB(() => assert.equal(getConfig("STREAM_KEY"), undefined));
  release();
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events, [{ phase: "planning" }, { result: { name: "Generated flow" } }]);
  await asA(() => assert.equal(getConfig("STREAM_KEY"), "private-a"));
  assert.throws(escaped, /encerrado/);
  assert.equal((await tenantJsonStream(mutation({}, "invalid"), async () => "leak", db)).status, 401);
  let aborted!: () => void;
  const stopped = new Promise<void>((resolve) => { aborted = resolve; });
  const cancelled = await tenantJsonStream(mutation({}), async (emit, signal) => {
    setConfig("CANCELLED_STREAM", "discard"); emit({ phase: "creating" });
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted(); resolve(); }, { once: true }));
    return { ignored: true };
  }, db);
  const reader = cancelled.body!.getReader(); await reader.read(); await reader.cancel(); await stopped;
  await asA(() => assert.equal(getConfig("CANCELLED_STREAM"), undefined));
});

test("subfluxos SaaS limitam recursão também quando o modelo escolhe o fluxo pelo nome", async () => {
  const flow = await asA(() => createTenantFlow("Recursive", false, { name: "Recursive", description: "", graph: template() }));
  const bridge = await asA(chatGPT), account = bridge.account, runner = bridge.run;
  let calls = 0;
  bridge.account = async () => ({ account: { type: "chatgpt" }, login: null, error: null });
  bridge.run = async () => { calls++; return callTool("interno:executar_fluxo", { fluxo: flow.name, entrada: "Repetir" }); };
  try {
    const result = await asA(() => startRun(flow.id, "Repetir"));
    assert.equal(calls, 6);
    assert.match(result.output, /Limite de agentes encadeados/);
    assert.equal((await asA(() => listTenantRuns(flow.id))).length, 6);
    assert.deepEqual(await asB(() => listTenantRuns()), []);
  } finally { bridge.account = account; bridge.run = runner; }
});
