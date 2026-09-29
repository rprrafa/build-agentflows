import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const dir = mkdtempSync(join(tmpdir(), "embed-test-")); process.env.DATA_DIR = dir;
const store = await import("./flow-store");
const embed = await import("./embed-store");
const runtime = await import("./embed-runtime");
const { pageTools } = await import("./embed-tools");
const { block, template } = await import("./flow-types");
const { chatGPT } = await import("./chatgpt");
const { abrirBanco } = await import("./store");
const { validCapabilities, ACTION_SCHEMA } = await import("./embed-protocol");
const sessionApi = await import("../app/api/embed/session/route");
const tokenApi = await import("../app/api/embed/token/route");
const attachmentApi = await import("../app/api/embed/attachments/route");
const bridge = chatGPT();
bridge.account = async () => ({ account:{type:"chatgpt",email:"test@example.com",planType:"plus"},login:null,error:null });
bridge.run = async () => "Resposta de teste";
const cap = [{ name:"page.getContext", description:"Conhecer a página",schema:ACTION_SCHEMA }];
function setup(graph = template()) {
  const f = store.createFlow("Chat de teste"); store.saveFlow(f.id,{name:f.name,description:"",graph}); store.publishFlow(f.id);
  embed.rotateEmbedKey(f.id); embed.saveEmbedSettings(f.id,{enabled:true,origins:["https://crud.example"],title:"Ajuda",welcome:"Olá",maxMinutes:30,maxCommands:3});
  const ticket = embed.issueEmbedTicket(f.id,"alice","https://crud.example");
  const req = new Request("https://flows.example/api/embed/session", {headers:{Authorization:`Bearer ${ticket.token}`}});
  const identity = embed.authenticateEmbed(req);
  const session = embed.connectSession(identity,"",randomUUID(),cap);
  return {f, ticket, identity, session};
}
function request(token:string, payload:unknown) { return new Request("https://flows.example/api/embed/session",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload)}); }
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test("tickets são restritos ao usuário, fluxo e origem; expiram e são revogados pela troca de chave", () => {
  const x=setup(); assert.equal(x.identity.subject,"alice");
  assert.throws(()=>embed.issueEmbedTicket(x.f.id,"alice","https://evil.example"),/autorizado/);
  const other={...x.identity,subject:"bob"}; assert.throws(()=>embed.ownedSession(x.session.id,other),/encontrada/);
  assert.throws(()=>embed.ownedSession(x.session.id,{...x.identity,flowId:randomUUID()}),/encontrada/);
  assert.throws(()=>embed.authenticateEmbed(new Request("https://flows.example",{headers:{Authorization:`Bearer ${x.ticket.token}garbage`}})),/expirou/);
  const now=Date.now; Date.now=()=>now()+11*60_000;
  try { assert.throws(()=>embed.authenticateEmbed(new Request("https://flows.example",{headers:{Authorization:`Bearer ${x.ticket.token}`}})),/expirou/); } finally { Date.now=now; }
  embed.rotateEmbedKey(x.f.id); assert.throws(()=>embed.authenticateEmbed(new Request("https://flows.example",{headers:{Authorization:`Bearer ${x.ticket.token}`}})),/expirou/);
});
test("desativar o chat ou despublicar o fluxo invalida acessos existentes",()=>{
  for(const mode of ["disable","unpublish"]){const x=setup();if(mode==="disable")embed.saveEmbedSettings(x.f.id,{...embed.embedSettings(x.f.id),enabled:false});else store.publishFlow(x.f.id,false);
  assert.throws(()=>embed.authenticateEmbed(new Request("https://flows.example",{headers:{Authorization:`Bearer ${x.ticket.token}`}})),/expirou/);}
});
test("sessão restaura a mesma aba, mantém conversas separadas e recusa outra aba",()=>{
  const x=setup();assert.equal(embed.connectSession(x.identity,x.session.id,x.session.tabId,cap).id,x.session.id);
  assert.throws(()=>embed.connectSession(x.identity,x.session.id,randomUUID(),cap),/outra aba/);
  assert.notEqual(embed.connectSession(x.identity,"",x.session.tabId,cap).id,x.session.id);
  assert.throws(()=>validCapabilities([...cap,...cap]),/repetida/);
  assert.throws(()=>validCapabilities([{...cap[0],name:"page.eval"}]),/desconhecida/);
  assert.throws(()=>validCapabilities([{...cap[0],name:"shell.exec"}]),/inválida/);
});
test("API pública não aceita origem divergente nem sessão alheia, chave de servidor nunca é ticket",async()=>{
  const x=setup();const mismatch=await sessionApi.POST(request(x.ticket.token,{action:"connect",origin:"https://evil.example",tabId:randomUUID(),capabilities:cap}));assert.equal(mismatch.status,403);
  const wrong=embed.issueEmbedTicket(x.f.id,"bob","https://crud.example");const response=await sessionApi.GET(new Request("https://flows.example/api/embed/session?id="+x.session.id,{headers:{Authorization:"Bearer "+wrong.token}}));assert.equal(response.status,404);
  const unauth=await tokenApi.POST(request("invalid",{flowId:x.f.id,subject:"alice",origin:"https://crud.example"}));assert.equal(unauth.status,401);
  const key=embed.rotateEmbedKey(x.f.id);const minted=await tokenApi.POST(request(key,{flowId:x.f.id,subject:"alice",origin:"https://crud.example"}));assert.equal(minted.status,200);
  assert.throws(()=>embed.authenticateEmbed(request(key,{})),/expirou/);
});
test("mensagem enfileirada retorna antes da execução, é idempotente e recuperável pelo snapshot",async()=>{
  const x=setup();const id=randomUUID();const first=await runtime.sendEmbedMessage(x.session.id,x.identity,"Olá",id,[]);
  assert.equal(store.getRun(first.runId).status,"running");assert.equal(store.getRun(first.runId).trace.length,0);
  assert.deepEqual(await runtime.sendEmbedMessage(x.session.id,x.identity,"Olá",id,[]),first);
  await assert.rejects(()=>runtime.sendEmbedMessage(x.session.id,x.identity,"Outra",randomUUID(),[]),/Conclua/);
  await runtime.drainEmbedJobs();const snapshot=runtime.sessionSnapshot(x.session.id);assert.equal(snapshot.turns.length,1);assert.equal(snapshot.turns[0].status,"completed");assert.equal(snapshot.turns[0].output,"Resposta de teste");
  assert.equal("graph" in snapshot.turns[0],false);assert.equal("state" in snapshot.turns[0],false);
  assert.deepEqual(await runtime.sendEmbedMessage(x.session.id,x.identity,"Olá",id,[]),first);
});
test("aprovação sobrevive ao reinício, retoma exatamente uma vez e cancelamento preserva a conversa",async()=>{
  const graph=template();graph.nodes[1]=block("approval","analista",0,0);graph.edges=[{id:"a",source:"inicio",target:"analista"},{id:"b",source:"analista",target:"resposta",sourceHandle:"yes"},{id:"c",source:"analista",target:"resposta",sourceHandle:"no"}];
  const x=setup(graph);const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Proposta",randomUUID(),[]);await runtime.drainEmbedJobs();assert.equal(store.getRun(runId).status,"waiting");
  store.interruptRuns();runtime.recoverEmbedJobs();assert.equal(store.getRun(runId).status,"waiting");
  await runtime.decideEmbedRun(x.session.id,runId,"yes");await assert.rejects(()=>runtime.decideEmbedRun(x.session.id,runId,"yes"),/aguardando/);await runtime.drainEmbedJobs();assert.equal(store.getRun(runId).status,"completed");
  const second=await runtime.sendEmbedMessage(x.session.id,x.identity,"Outra",randomUUID(),[]);await runtime.decideEmbedRun(x.session.id,second.runId,"cancel");await runtime.drainEmbedJobs();assert.equal(store.getRun(second.runId).status,"cancelled");assert.equal(runtime.sessionSnapshot(x.session.id).turns.length,2);
});
test("comando exige claim único, resposta correlacionada e rejeita resposta tardia ou após cancelamento",async()=>{
  const x=setup();const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Observe",randomUUID(),[]);
  function command(){return embed.putCommand({id:randomUUID(),sessionId:x.session.id,runId,name:"page.getContext",args:{},status:"pending",createdAt:Date.now(),expiresAt:Date.now()+5000});}
  const c=command();assert.throws(()=>embed.settleCommand(x.session.id,c.id,"result",{}),/não recebida/);embed.settleCommand(x.session.id,c.id,"claim");assert.throws(()=>embed.settleCommand(x.session.id,c.id,"claim"),/já recebida/);
  assert.throws(()=>embed.settleCommand(randomUUID(),c.id,"result",{}),/encontrada/);
  embed.settleCommand(x.session.id,c.id,"result",{url:"/clientes"});assert.equal(embed.command(c.id).status,"completed");assert.throws(()=>embed.settleCommand(x.session.id,c.id,"result",{}),/já respondida/);
  const late=command();embed.putCommand({...late,expiresAt:Date.now()-1});assert.throws(()=>embed.settleCommand(x.session.id,late.id,"claim"),/ativa/);
  const cancelled=command();await runtime.decideEmbedRun(x.session.id,runId,"cancel");assert.equal(embed.command(cancelled.id).status,"cancelled");assert.throws(()=>embed.settleCommand(x.session.id,cancelled.id,"result",{}),/ativa/);
});
test("ferramentas de página são descobertas automaticamente e o agente recebe o resultado real",async()=>{
  const x=setup();const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Observe",randomUUID(),[]);const run=store.getRun(runId);const controller=new AbortController();
  const tools=pageTools(run,controller.signal);assert.equal(tools.length,1);assert.equal(pageTools({...run,embedSessionId:undefined},controller.signal).length,0);
  const pending=tools[0].call({});await assert.rejects(()=>tools[0].call({}),/Aguarde/);const c=embed.commands(x.session.id)[0];assert.equal(store.getRun(runId).pageCommandId,c.id);
  embed.settleCommand(x.session.id,c.id,"claim");embed.settleCommand(x.session.id,c.id,"result",{title:"Clientes"});const result=JSON.parse(await pending);assert.equal(result.result.title,"Clientes");assert.equal(store.getRun(runId).pageCommandId,undefined);
  const s=embed.getSession(x.session.id);s.connectedAt=Date.now()-31_000;embed.putSession(s);assert.equal(pageTools(run,controller.signal).length,0);
  await runtime.decideEmbedRun(x.session.id,runId,"cancel");
});
test("cancelamento interrompe a espera da página e nenhuma ação posterior é permitida",async()=>{
  const x=setup();const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Observe",randomUUID(),[]);const run=store.getRun(runId),controller=new AbortController();const tool=pageTools(run,controller.signal)[0];
  const pending=tool.call({});controller.abort();await assert.rejects(()=>pending,/cancelada/);assert.equal(embed.commands(x.session.id)[0].status,"cancelled");await runtime.decideEmbedRun(x.session.id,runId,"cancel");
});
test("limites de ações e tempo são aplicados pelo runtime",async()=>{
  const x=setup();embed.saveEmbedSettings(x.f.id,{...embed.embedSettings(x.f.id),maxCommands:1});const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Observe",randomUUID(),[]);const run=store.getRun(runId),controller=new AbortController();
  embed.putCommand({id:randomUUID(),sessionId:x.session.id,runId,name:"page.getContext",args:{},status:"failed",createdAt:Date.now(),expiresAt:Date.now()});
  await assert.rejects(()=>pageTools(run,controller.signal)[0].call({}),/Limite/);
  run.activeMs=run.maxActiveMs;store.putRun(run);await runtime.drainEmbedJobs();assert.equal(store.getRun(runId).status,"failed");assert.match(store.getRun(runId).error||"",/Limite|tempo/);
});
test("reinício não repete efeitos: pede revisão e limita retomadas",async()=>{
  const x=setup();const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Observe",randomUUID(),[]);
  for(let i=0;i<3;i++){
    abrirBanco().prepare("UPDATE embed_jobs SET status='working' WHERE run_id=?").run(runId);runtime.recoverEmbedJobs();const r=store.getRun(runId);assert.equal(r.interrupted,true);assert.equal(r.status,"waiting");
    if(i<2)await runtime.decideEmbedRun(x.session.id,runId,"retry");else await assert.rejects(()=>runtime.decideEmbedRun(x.session.id,runId,"retry"),/Limite/);
  }
  await runtime.decideEmbedRun(x.session.id,runId,"cancel");
});
test("anexo de outra sessão do mesmo fluxo não pode ser usado",async()=>{
  const x=setup();const {saveAttachment}=await import("./attachments");const a=await saveAttachment(x.f.id,new File(["nota"],"nota.txt"));
  await assert.rejects(()=>runtime.sendEmbedMessage(x.session.id,x.identity,"Veja",randomUUID(),[a.id]),/não pertence/);
  const form=new FormData();form.set("sessionId",x.session.id);form.set("file",new File(["exemplo"],"exemplo.txt"));
  const response=await attachmentApi.POST(new Request("https://flows.example/api/embed/attachments",{method:"POST",headers:{Authorization:"Bearer "+x.ticket.token},body:form}));assert.equal(response.status,200);const uploaded=await response.json();assert.ok(embed.getSession(x.session.id).attachments.includes(uploaded.id));
});
test("captura recebida chega como imagem ao modelo na análise complementar",async()=>{
  const x=setup();embed.connectSession(x.identity,x.session.id,x.session.tabId,[{name:"page.requestScreenshot",description:"Capturar",schema:ACTION_SCHEMA}]);
  const sharp=(await import("sharp")).default;const {saveAttachment}=await import("./attachments");const bytes=await sharp({create:{width:8,height:8,channels:3,background:"white"}}).png().toBuffer();const a=await saveAttachment(x.f.id,new File([new Uint8Array(bytes)],"captura.png"));const s=embed.getSession(x.session.id);s.attachments.push(a.id);embed.putSession(s);
  const {runId}=await runtime.sendEmbedMessage(x.session.id,x.identity,"Veja o problema",randomUUID(),[]);let calls=0;
  const original=bridge.run;bridge.run=async options=>{calls++;if(calls===1){const promise=options.tools![0].call({});const c=embed.commands(x.session.id)[0];embed.settleCommand(x.session.id,c.id,"claim");embed.settleCommand(x.session.id,c.id,"result",{attachmentId:a.id});await promise;return "Vou analisar a captura.";}assert.equal(options.images?.length,1);return "Imagem analisada";};
  try{await runtime.drainEmbedJobs();assert.equal(store.getRun(runId).output,"Imagem analisada");assert.equal(calls,2);}finally{bridge.run=original;}
});

test("Segurança limita origens por interseção e revoga tickets existentes", async () => {
  const security = await import("./embed-security");
  const x = setup();
  try {
    assert.throws(() => security.saveEmbedSecurity(["https://example.com/path"]), /origens/);
    assert.throws(() => security.saveEmbedSecurity(["https://*.example.com"]), /origens/);
    security.saveEmbedSecurity(["https://outro.example"]);
    assert.deepEqual(security.effectiveEmbedOrigins(["https://crud.example"]), []);
    assert.throws(() => embed.issueEmbedTicket(x.f.id, "alice", "https://crud.example"), /autorizado/);
    assert.throws(() => embed.authenticateEmbed(new Request("https://flows.example", { headers: { Authorization: `Bearer ${x.ticket.token}` } })), /expirou/);
    security.saveEmbedSecurity(["https://crud.example"]);
    assert.equal(embed.authenticateEmbed(new Request("https://flows.example", { headers: { Authorization: `Bearer ${x.ticket.token}` } })).subject, "alice");
  } finally { security.saveEmbedSecurity([]); }
});

test("visualização do chat persiste, mantém compatibilidade e rejeita modos inválidos", () => {
  const { f } = setup();
  assert.equal(embed.embedSettings(f.id).displayMode, "detailed");
  for (const displayMode of ["simple", "detailed"] as const) {
    embed.saveEmbedSettings(f.id, { ...embed.embedSettings(f.id), displayMode });
    assert.equal(embed.embedSettings(f.id).displayMode, displayMode);
  }
  assert.throws(() => embed.saveEmbedSettings(f.id, { ...embed.embedSettings(f.id), displayMode: "invalid" as "simple" }), /visualização/);
  const legacy = { ...embed.embedSettings(f.id) };
  delete legacy.displayMode;
  abrirBanco().prepare("UPDATE embed_settings SET body=? WHERE flow_id=?").run(JSON.stringify(legacy), f.id);
  assert.equal(embed.embedSettings(f.id).displayMode, "detailed");
});

test("lista global restringe domínios do fluxo sem liberar sites não cadastrados", async () => {
  const security = await import("./embed-security");
  const { f } = setup();
  try {
    security.saveEmbedSecurity(["https://other.example"]);
    assert.throws(() => embed.issueEmbedTicket(f.id, "alice", "https://crud.example"), /autorizado/);
    security.saveEmbedSecurity(["https://crud.example"]);
    assert.ok(embed.issueEmbedTicket(f.id, "alice", "https://crud.example").token);
    assert.throws(() => security.saveEmbedSecurity(["https://crud.example/path"]), /sem caminhos/);
    security.saveEmbedSecurity([]);
    assert.ok(embed.issueEmbedTicket(f.id, "alice", "https://crud.example").token);
    assert.throws(() => embed.issueEmbedTicket(f.id, "alice", "https://other.example"), /autorizado/);
  } finally {
    security.saveEmbedSecurity([]);
  }
});

test("chat vazio aceita localhost por padrão, em qualquer porta, sem liberar outros sites", async () => {
  const security = await import("./embed-security");
  const f = store.createFlow("Local");
  store.saveFlow(f.id, { name: f.name, description: "", graph: template() });
  const defaults = embed.embedSettings(f.id);
  assert.equal(defaults.enabled, true);
  embed.saveEmbedSettings(f.id, defaults);
  assert.equal(embed.hasEmbedKey(f.id), true);
  try {
    security.saveEmbedSecurity([]);
    for (const origin of ["http://localhost", "http://localhost:5173", "https://localhost:8443", "http://127.0.0.1:3000"]) {
      const ticket = embed.issueEmbedTicket(f.id, "alice", origin);
      assert.equal(embed.authenticateEmbed(request(ticket.token, {})).origin, origin);
    }
    for (const origin of ["https://example.com", "http://localhost.evil.com", "http://localhost:3000/path", "http://user@localhost:3000", "http://localhost:*"]) {
      assert.throws(() => embed.issueEmbedTicket(f.id, "alice", origin), /autorizado/);
    }
    assert.ok(security.effectiveEmbedOrigins([]).includes("http://localhost:*"));
    security.saveEmbedSecurity(["http://localhost:5173"]);
    assert.deepEqual(security.effectiveEmbedOrigins([]), ["http://localhost:5173"]);
    assert.ok(embed.issueEmbedTicket(f.id, "alice", "http://localhost:5173").token);
    assert.throws(() => embed.issueEmbedTicket(f.id, "alice", "http://localhost:3000"), /autorizado/);
    security.saveEmbedSecurity([]);
    embed.saveEmbedSettings(f.id, { ...defaults, origins: ["https://app.example"] });
    assert.throws(() => embed.issueEmbedTicket(f.id, "alice", "http://localhost:5173"), /autorizado/);
  } finally { security.saveEmbedSecurity([]); }
});

test("preview prepara a chave internamente e usa a origem real da página", async () => {
  const route = await import("../app/api/flows/[id]/embed/route");
  const f = store.createFlow("Preview local");
  store.saveFlow(f.id, { name: f.name, description: "", graph: template() });
  assert.equal(embed.hasEmbedKey(f.id), false);
  const response = await route.POST(new Request("http://localhost:3000/api/flows/" + f.id + "/embed", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ action: "preview" }),
  }), { params: Promise.resolve({ id: f.id }) });
  assert.equal(response.status, 200);
  assert.equal(embed.hasEmbedKey(f.id), true);
  const ticket = await response.json();
  assert.equal(embed.authenticateEmbed(request(ticket.token, {})).origin, "http://127.0.0.1:3000");
  assert.equal("key" in ticket, false);
});
