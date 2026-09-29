import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createTenantTestContext } from "../scripts/tenant-test-context";
import { createTenantFlow, publishTenantFlow, getTenantRun } from "./tenant-flows";
import { block, template, type Graph } from "./flow-types";
import { chatGPT } from "./chatgpt";
import * as embed from "./embed-store";
import * as runtime from "./embed-runtime";
import { pageTools } from "./embed-tools";
import { ACTION_SCHEMA, validCapabilities } from "./embed-protocol";
import { saveEmbedSecurity, effectiveEmbedOrigins } from "./embed-security";
import { claimJob, recoverExpiredJobs } from "./saas-jobs";
import { runClaimedJob } from "./saas-worker";
import { hashToken, randomToken } from "./saas-security";
import { withTenantSession } from "./tenant-context";
import { saveAttachment } from "./attachment-service";
import * as sessionApi from "../app/api/embed/session/route";
import * as tokenApi from "../app/api/embed/token/route";
import * as attachmentApi from "../app/api/embed/attachments/route";
import * as downloadApi from "../app/api/embed/attachments/[id]/route";
import * as settingsApi from "../app/api/flows/[id]/embed/route";
import { withEmbedOwner } from "./embed-http";

const cap = [{ name: "page.getContext", description: "Conhecer a página", schema: ACTION_SCHEMA }];
function request(token: string, data?: unknown, path = "/api/embed/session") {
  return new Request("https://app.example.com" + path, { method: data === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
}
async function setup(t: TestContext, graph: Graph = template()) {
  const tenant = await createTenantTestContext(); t.after(tenant.close);
  const prepared = await tenant.asTenant(async () => {
    const flow = await createTenantFlow("Chat de teste", false, { name: "Chat de teste", description: "", graph });
    const bridge = chatGPT();
    bridge.account = async () => ({ account: { type: "chatgpt", email: "fixture@example.com", planType: "plus" }, login: null, error: null });
    bridge.models = async () => [{ id: "vision", name: "Vision", inputModalities: ["text", "image"], isDefault: true }];
    bridge.run = async () => "Resposta de teste";
    const key = await embed.rotateEmbedKey(flow.id);
    await embed.saveEmbedSettings(flow.id, { enabled: true, origins: ["https://crud.example"], title: "Ajuda", welcome: "Olá", maxMinutes: 15, maxCommands: 3 });
    const ticket = await embed.issueEmbedTicket(flow.id, "alice", "https://crud.example");
    const identity = await embed.authenticateEmbed(request(ticket.token));
    const session = await embed.connectSession(identity, "", randomUUID(), cap);
    return { flow, key, ticket, identity, session, bridge };
  });
  return { ...tenant, ...prepared,
    send: (id = randomUUID()) => tenant.asTenant(() => runtime.sendEmbedMessage(prepared.session.id, prepared.identity, "Observe", id, [])),
    drain: async () => { const job = await claimJob(tenant.db); assert.ok(job); return runClaimedJob(tenant.db, job); },
  };
}

test("tickets validam assinatura, prazo, usuário, fluxo e geração da chave", async t => {
  const x = await setup(t);
  await x.asTenant(async () => {
    assert.equal(x.identity.subject, "alice");
    await assert.rejects(embed.issueEmbedTicket(x.flow.id, "alice", "https://evil.example"), /autorizado/);
    await assert.rejects(embed.ownedSession(x.session.id, { ...x.identity, subject: "bob" }), /encontrada/);
    await assert.rejects(embed.ownedSession(x.session.id, { ...x.identity, flowId: randomUUID() }), /encontrada/);
    await assert.rejects(embed.authenticateEmbed(request(x.ticket.token + "x")), /expirou/);
    const payload = Buffer.from(JSON.stringify({ ...x.identity, exp: Date.now() - 1 })).toString("base64url");
    await assert.rejects(embed.authenticateEmbed(request(payload + "." + createHmac("sha256", x.key).update(payload).digest("base64url"))), /expirou/);
    await embed.rotateEmbedKey(x.flow.id);
    await assert.rejects(embed.authenticateEmbed(request(x.ticket.token)), /expirou/);
  });
});

test("desativação, despublicação e suspensão da conta revogam acesso público", async t => {
  const x = await setup(t);
  await x.asTenant(async () => {
    const settings = await embed.embedSettings(x.flow.id);
    await embed.saveEmbedSettings(x.flow.id, { ...settings, enabled: false });
    await assert.rejects(embed.authenticateEmbed(request(x.ticket.token)), /expirou/);
    await embed.saveEmbedSettings(x.flow.id, settings);
    await publishTenantFlow(x.flow.id, false);
    await assert.rejects(embed.authenticateEmbed(request(x.ticket.token)), /expirou/);
  });
  await x.db.query("UPDATE users SET beta_status='blocked' WHERE id=$1", [x.owner]);
  const response = await x.connect(() => sessionApi.GET(request(x.ticket.token, undefined, `/api/embed/session?id=${x.session.id}`)));
  assert.equal(response.status, 403);
});

test("sessões mantêm aba e identidade, expiram e validam capacidades", async t => {
  const x = await setup(t);
  await x.asTenant(async () => {
    assert.equal((await embed.connectSession(x.identity, x.session.id, x.session.tabId, cap)).id, x.session.id);
    await assert.rejects(embed.connectSession(x.identity, x.session.id, randomUUID(), cap), /outra aba/);
    assert.notEqual((await embed.connectSession(x.identity, "", x.session.tabId, cap)).id, x.session.id);
    assert.throws(() => validCapabilities([...cap, ...cap]), /repetida/);
    assert.throws(() => validCapabilities([{ ...cap[0], name: "page.eval" }]), /desconhecida/);
    assert.throws(() => validCapabilities([{ ...cap[0], name: "shell.exec" }]), /inválida/);
    await x.db.query("UPDATE embed_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND id=$2", [x.owner, x.session.id]);
    await assert.rejects(embed.getSession(x.session.id), /expirada/);
  });
});

test("API pública exige ticket e origem vinculados; chave do servidor só emite ticket", async t => {
  const x = await setup(t);
  assert.equal((await x.connect(() => sessionApi.POST(request(x.ticket.token, { action: "connect", origin: "https://evil.example", tabId: randomUUID(), capabilities: cap })))).status, 403);
  const bob = await x.asTenant(() => embed.issueEmbedTicket(x.flow.id, "bob", "https://crud.example"));
  assert.equal((await x.connect(() => sessionApi.GET(request(bob.token, undefined, `/api/embed/session?id=${x.session.id}`)))).status, 404);
  assert.equal((await x.connect(() => tokenApi.POST(request("invalid", { flowId: x.flow.id, subject: "alice", origin: "https://crud.example" })))).status, 401);
  assert.equal((await x.connect(() => tokenApi.POST(request(x.key, { flowId: x.flow.id, subject: "alice", origin: "https://crud.example" })))).status, 200);
  assert.equal((await x.connect(() => sessionApi.GET(request(x.key)))).status, 401);
});

test("mensagem e despacho são atômicos, idempotentes e usam o worker compartilhado", async t => {
  const x = await setup(t), id = randomUUID();
  const responses = await Promise.all([x.send(id), x.send(id)]);
  assert.equal(responses[0].runId, responses[1].runId);
  assert.equal((await x.db.query("SELECT id FROM jobs WHERE user_id=$1", [x.owner])).rows.length, 1);
  await assert.rejects(x.send(), /Conclua ou cancele/);
  assert.equal((await x.drain()).ok, true);
  await x.asTenant(async () => {
    const snapshot = await runtime.sessionSnapshot(x.session.id);
    assert.equal(snapshot.turns[0].status, "completed"); assert.equal(snapshot.turns[0].output, "Resposta de teste");
    assert.equal((await embed.getSession(x.session.id)).runIds.length, 1);
  });
});

test("aprovação e cancelamento passam pela fila e decisões repetidas falham", async t => {
  const graph = template(); graph.nodes[1] = block("approval", graph.nodes[1].id, 0, 0); graph.edges[1].sourceHandle = "yes";
  graph.edges.push({ id: "no", source: graph.nodes[1].id, target: graph.nodes[2].id, sourceHandle: "no" });
  const x = await setup(t, graph), { runId } = await x.send();
  await x.drain();
  await x.asTenant(async () => {
    assert.equal((await getTenantRun(runId)).status, "waiting");
    await runtime.decideEmbedRun(x.session.id, runId, "yes");
    await assert.rejects(runtime.decideEmbedRun(x.session.id, runId, "yes"), /terminando|decisão/);
  });
  await x.drain();
  const next = await x.send();
  await x.asTenant(async () => { await runtime.decideEmbedRun(x.session.id, next.runId, "cancel"); assert.equal((await getTenantRun(next.runId)).status, "cancelled"); });
});

test("comandos persistem, só uma chamada recebe a ação e resultado não pode repetir", async t => {
  const x = await setup(t), { runId } = await x.send();
  await x.asTenant(async () => {
    const run = await getTenantRun(runId), controller = new AbortController();
    const tools = await pageTools(run, controller.signal);
    const pending = tools[0].call({ selector: "main" });
    let command;
    for (let i = 0; i < 100; i++) { command = (await embed.commands(x.session.id))[0]; if (command) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(command);
    const claims = await Promise.allSettled([embed.settleCommand(x.session.id, command.id, "claim"), embed.settleCommand(x.session.id, command.id, "claim")]);
    assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
    await embed.settleCommand(x.session.id, command.id, "result", { title: "Clientes" });
    await assert.rejects(embed.settleCommand(x.session.id, command.id, "result", {}), /já respondida/);
    assert.equal(JSON.parse(await pending).result.title, "Clientes");
    assert.equal((await getTenantRun(runId)).pageCommandId, undefined);
    await embed.updateSession(x.session.id, session => { session.connectedAt = Date.now() - 31000; });
    assert.equal((await pageTools(run, controller.signal)).length, 0);
  });
});

test("cancelamento interrompe espera; limite de comandos recusa nova ação", async t => {
  const x = await setup(t), { runId } = await x.send();
  await x.asTenant(async () => {
    await embed.saveEmbedSettings(x.flow.id, { ...await embed.embedSettings(x.flow.id), maxCommands: 1 });
    const run = await getTenantRun(runId), controller = new AbortController();
    const pending = (await pageTools(run, controller.signal))[0].call({});
    for (let i = 0; i < 100 && !(await embed.commands(x.session.id)).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort(); await assert.rejects(pending, /cancelada/);
    assert.equal((await embed.commands(x.session.id))[0].status, "cancelled");
    await assert.rejects((await pageTools(run, new AbortController().signal))[0].call({}), /Limite/);
  });
});

test("recuperação do worker interrompido não repete efeitos externos", async t => {
  const x = await setup(t), { runId } = await x.send(), job = await claimJob(x.db); assert.ok(job);
  await x.db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
  assert.equal(await recoverExpiredJobs(x.db), 1);
  await x.asTenant(async () => {
    const run = await getTenantRun(runId); assert.equal(run.status, "failed"); assert.equal(run.interrupted, true);
    await assert.rejects(runtime.decideEmbedRun(x.session.id, runId, "retry"), /Revise/);
  });
  assert.equal(await claimJob(x.db), undefined);
});

test("anexo exige a conversa correta, inclusive entre visitantes do mesmo fluxo", async t => {
  const x = await setup(t);
  const unbound = await x.asTenant(() => saveAttachment(x.flow.id, new File(["nota"], "nota.txt")));
  await assert.rejects(x.asTenant(() => runtime.sendEmbedMessage(x.session.id, x.identity, "Veja", randomUUID(), [unbound.id])), /não pertence/);
  const form = new FormData(); form.set("sessionId", x.session.id); form.set("file", new File(["documento"], "exemplo.txt"));
  const uploaded = await x.connect(() => attachmentApi.POST(new Request("https://app.example.com/api/embed/attachments", { method: "POST", headers: { Authorization: `Bearer ${x.ticket.token}` }, body: form })));
  assert.equal(uploaded.status, 200); const file = await uploaded.json();
  const url = `/api/embed/attachments/${file.id}?sessionId=${x.session.id}`;
  const owner = await x.connect(() => downloadApi.GET(request(x.ticket.token, undefined, url), { params: Promise.resolve({ id: file.id }) }));
  assert.equal(await owner.text(), "documento");
  const bob = await x.asTenant(() => embed.issueEmbedTicket(x.flow.id, "bob", "https://crud.example"));
  assert.equal((await x.connect(() => downloadApi.GET(request(bob.token, undefined, url), { params: Promise.resolve({ id: file.id }) }))).status, 404);
});

test("origens da conta restringem as do fluxo; visualização e limites são validados", async t => {
  const x = await setup(t);
  await x.asTenant(async () => {
    assert.throws(() => saveEmbedSecurity(["https://example.com/path"]), /origens/);
    assert.throws(() => saveEmbedSecurity(["https://*.example.com"]), /origens/);
    saveEmbedSecurity(["https://other.example"]);
    assert.deepEqual(effectiveEmbedOrigins(["https://crud.example"]), []);
    await assert.rejects(embed.authenticateEmbed(request(x.ticket.token)), /expirou/);
    saveEmbedSecurity(["https://crud.example"]);
    assert.equal((await embed.authenticateEmbed(request(x.ticket.token))).subject, "alice");
    const settings = await embed.embedSettings(x.flow.id);
    for (const displayMode of ["simple", "detailed"] as const) { await embed.saveEmbedSettings(x.flow.id, { ...settings, displayMode }); assert.equal((await embed.embedSettings(x.flow.id)).displayMode, displayMode); }
    await assert.rejects(embed.saveEmbedSettings(x.flow.id, { ...settings, displayMode: "invalid" as "simple" }), /visualização/);
    await assert.rejects(embed.saveEmbedSettings(x.flow.id, { ...settings, maxMinutes: 16 }), /Confira/);
    saveEmbedSecurity([]);
    await embed.saveEmbedSettings(x.flow.id, { ...settings, origins: [] });
    for (const origin of ["http://localhost:5173", "https://localhost:8443", "http://127.0.0.1:3000"]) assert.ok((await embed.issueEmbedTicket(x.flow.id, "alice", origin)).token);
    await assert.rejects(embed.issueEmbedTicket(x.flow.id, "alice", "http://localhost.evil.com"), /autorizado/);
  });
});

test("configuração privada exige dono; IDs ambíguos e dados de outra conta são recusados", async t => {
  const x = await setup(t), other = randomUUID(), token = randomToken();
  await x.db.query("INSERT INTO users(id,name,email,email_verified_at,beta_status) VALUES($1,'Other',$2,now(),'approved')", [other, `${other}@example.com`]);
  await x.db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hashToken(token), other]);
  const req = x.request(`/api/flows/${x.flow.id}/embed`); req.headers.set("cookie", `agentflows_session=${token}`);
  assert.equal((await x.connect(() => settingsApi.GET(req, { params: Promise.resolve({ id: x.flow.id }) }))).status, 404);
  await withTenantSession(x.db, token, async () => { await assert.rejects(embed.getSession(x.session.id), /encontrada/); });
  // Even a duplicated public flow ID must not choose a different owner's credentials.
  await x.db.query("INSERT INTO flows(user_id,id,body) SELECT $1,id,body FROM flows WHERE user_id=$2 AND id=$3", [other, x.owner, x.flow.id]);
  await assert.rejects(withEmbedOwner(x.flow.id, async () => "must not run", x.db), /não encontrado/);
});

test("preview usa sessão do dono e origem fixa, sem expor chave ou depender da lista pública", async t => {
  const x = await setup(t);
  const response = await x.connect(() => settingsApi.POST(x.request(`/api/flows/${x.flow.id}/embed`, { method: "POST", headers: { host: "evil.example", "x-forwarded-host": "evil.example" }, body: JSON.stringify({ action: "preview" }) }), { params: Promise.resolve({ id: x.flow.id }) }));
  assert.equal(response.status, 200);
  const ticket = await response.json(); assert.equal("key" in ticket, false);
  const identity = await x.asTenant(() => embed.authenticateEmbed(request(ticket.token)));
  assert.equal(identity.origin, "https://app.example.com"); assert.equal(identity.preview, true);
  const unauthorized = await x.connect(() => settingsApi.POST(request(x.key, { action: "preview" }), { params: Promise.resolve({ id: x.flow.id }) }));
  assert.notEqual(unauthorized.status, 200);
});

test("captura de página chega ao modelo pelo worker e ações não se repetem", async t => {
  const x = await setup(t);
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  await x.asTenant(async () => {
    await embed.connectSession(x.identity, x.session.id, x.session.tabId, [{ name: "page.requestScreenshot", description: "Capturar", schema: ACTION_SCHEMA }]);
    const attachment = await saveAttachment(x.flow.id, new File([new Uint8Array(png)], "captura.png"));
    await embed.updateSession(x.session.id, session => { session.attachments.push(attachment.id); });
    let calls = 0;
    x.bridge.run = async options => {
      calls++;
      if (calls === 1) {
        const pending = options.tools![0].call({});
        let command;
        for (let i = 0; i < 100; i++) { command = (await embed.commands(x.session.id))[0]; if (command) break; await new Promise(resolve => setTimeout(resolve, 10)); }
        assert.ok(command);
        await embed.settleCommand(x.session.id, command.id, "claim");
        await embed.settleCommand(x.session.id, command.id, "result", { attachmentId: attachment.id });
        await pending; return "Vou analisar a captura.";
      }
      assert.equal(options.images?.length, 1);
      assert.equal(options.images?.[0], `data:image/png;base64,${png.toString("base64")}`);
      return "Imagem analisada";
    };
  });
  const { runId } = await x.send();
  assert.equal((await x.drain()).ok, true);
  assert.equal(await x.asTenant(async () => (await getTenantRun(runId)).output), "Imagem analisada");
});

test("worker não inicia tarefas quando a chave da conversa foi revogada", async t => {
  const x = await setup(t), { runId } = await x.send(); let calls = 0;
  x.bridge.run = async () => { calls++; return "não executar"; };
  await x.asTenant(() => embed.rotateEmbedKey(x.flow.id));
  assert.equal((await x.drain()).ok, false);
  assert.equal(calls, 0);
  assert.equal(await x.asTenant(async () => (await getTenantRun(runId)).status), "failed");
});

test("conversas compartilham backlog e vaga do usuário, sem deixar runs órfãos ao atingir cota", async t => {
  const x = await setup(t); const first = await x.send();
  await x.asTenant(async () => {
    for (let index = 1; index < 10; index++) {
      const session = await embed.connectSession(x.identity, "", randomUUID(), []);
      await runtime.sendEmbedMessage(session.id, x.identity, "Mensagem", randomUUID(), []);
    }
    const session = await embed.connectSession(x.identity, "", randomUUID(), []);
    await assert.rejects(runtime.sendEmbedMessage(session.id, x.identity, "Excesso", randomUUID(), []), /fila atingiu/);
    assert.equal((await embed.getSession(session.id)).runIds.length, 0);
    assert.equal((await x.db.query("SELECT id FROM runs WHERE user_id=$1", [x.owner])).rows.length, 10);
  });
  const job = await claimJob(x.db); assert.ok(job);
  assert.equal(await claimJob(x.db), undefined, "outras conversas não contornam uma vaga por dono");
  assert.equal(job.run_id, first.runId);
});

test("relações do banco impedem comandos e sessões apontando para fluxo ou dono alheio", async t => {
  const x = await setup(t), { runId } = await x.send();
  await x.asTenant(async () => {
    const second = await createTenantFlow("Outro", false, { name: "Outro", description: "", graph: template() });
    const id = randomUUID();
    const wrong = { ...x.session, id, flowId: second.id };
    await x.db.query("INSERT INTO embed_sessions(user_id,id,flow_id,body,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [x.owner, id, second.id, JSON.stringify(wrong)]);
    await assert.rejects(x.db.query("INSERT INTO embed_requests(user_id,session_id,request_id,flow_id,run_id) VALUES($1,$2,$3,$4,$5)", [x.owner, id, randomUUID(), second.id, runId]), /foreign key/);
    await assert.rejects(x.db.query("INSERT INTO embed_settings(user_id,flow_id,body) VALUES($1,$2,'{}')", [randomUUID(), x.flow.id]), /foreign key/);
    await assert.rejects(embed.createCommand({ id: randomUUID(), sessionId: id, runId, name: "page.getContext", args: {}, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + 10000 }, 3), /não está autorizada/);
  });
});

test("tempo consumido limita retomadas de execução sem executar o modelo", async t => {
  const x = await setup(t), { runId } = await x.send(); let calls = 0;
  x.bridge.run = async () => { calls++; return "não executar"; };
  await x.db.query("UPDATE runs SET body=body || '{\"activeMs\":900000}'::jsonb WHERE user_id=$1 AND id=$2", [x.owner, runId]);
  assert.equal((await x.drain()).ok, false);
  assert.equal(calls, 0);
});

test("imagens geradas são baixadas só pelo visitante da conversa que as produziu", async t => {
  const x = await setup(t), { runId } = await x.send();
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const image = await x.asTenant(async () => {
    const image = await saveAttachment(x.flow.id, new File([new Uint8Array(png)], "imagem.png"), true);
    const run = await getTenantRun(runId); run.status = "completed"; run.output = `![Imagem](/api/attachments/${image.id})`;
    run.trace.push({ nodeId: run.graph.nodes[1].id, label: "Imagem", at: new Date().toISOString(), ms: 1, output: run.output, images: [image] });
    const { putTenantRun } = await import("./tenant-flows"); await putTenantRun(run);
    assert.equal((await runtime.sessionSnapshot(x.session.id)).turns[0].images?.[0].id, image.id);
    return image;
  });
  const path = `/api/embed/attachments/${image.id}?sessionId=${x.session.id}`;
  const response = await x.connect(() => downloadApi.GET(request(x.ticket.token, undefined, path), { params: Promise.resolve({ id: image.id }) }));
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  const different = await x.asTenant(() => embed.connectSession(x.identity, "", randomUUID(), []));
  const denied = await x.connect(() => downloadApi.GET(request(x.ticket.token, undefined, `/api/embed/attachments/${image.id}?sessionId=${different.id}`), { params: Promise.resolve({ id: image.id }) }));
  assert.equal(denied.status, 404);
});
