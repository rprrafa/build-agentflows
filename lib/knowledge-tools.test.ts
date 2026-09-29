import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import type { KnowledgeBinding } from "./knowledge-settings";
const dir = mkdtempSync(join(tmpdir(), "knowledge-tools-"));
process.env.DATA_DIR = dir;
const store = await import("./knowledge-store");
const runtime = await import("./knowledge-index");
const { agentKnowledge } = await import("./knowledge-agent");
const { knowledgeSettings } = await import("./knowledge-settings");
const { DEFAULT_INDEX, DEFAULT_SPLITTER } = await import("./knowledge-types");
const { template } = await import("./flow-types");
const flows = await import("./flow-store");
const { startRun } = await import("./flow-runtime");
const { chatGPT } = await import("./chatgpt");
const { setConfig, abrirBanco } = await import("./store");
let embeddingCalls = 0;
const server = createServer(async(req,res)=>{
  let raw="";for await(const part of req)raw+=part;
  const body=JSON.parse(raw);embeddingCalls+=body.input.length;
  res.setHeader("Content-Type","application/json");res.end(JSON.stringify({data:body.input.map((_:string,index:number)=>({index,embedding:[1,0.1,0]}))}));
});
server.listen(0,"127.0.0.1");await once(server,"listening");
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
test.after(()=>{server.close();server.closeAllConnections();rmSync(dir,{recursive:true,force:true});});
async function base(name:string,description:string,text:string) {
  const b=store.createKnowledgeBase({name,description});
  store.updateKnowledgeBase(b.id,{config:{...structuredClone(DEFAULT_INDEX),embeddings:{provider:"openai",model:"fixture",url,apiKey:"fixture"}}});
  const source=store.saveKnowledgeSource(b.id,{name:`Manual ${name}`,loader:"plain",config:{text},splitter:DEFAULT_SPLITTER,metadata:{}});
  await runtime.processKnowledgeSource(b.id,source.id);await runtime.indexKnowledge(b.id);return store.getKnowledgeBase(b.id);
}
const refunds=await base("Reembolsos","Consulte quando houver dúvidas sobre cancelamento e devolução de pagamentos.","O reembolso pode ser solicitado em sete dias.");
const shipping=await base("Entregas","Consulte quando houver dúvidas sobre frete e prazo de entrega.","A entrega ocorre em três dias úteis.");
const bindings:KnowledgeBinding[]=[
  {baseId:refunds.id,description:refunds.description,references:true},
  {baseId:shipping.id,description:shipping.description,references:false},
];
const config={knowledgeBases:JSON.stringify(bindings)};
function flow(kind:"agent"|"llm",extra:Record<string,string>={}) {
  const graph=template();graph.nodes[1].data.kind=kind;graph.nodes[1].data.config={...graph.nodes[1].data.config,...config,...extra};
  return flows.createSavedFlow({name:`Conhecimento ${kind}`,description:"",graph});
}

test("bases são ferramentas distintas; só consultar executa embeddings, com referências isoladas",async()=>{
  const before=embeddingCalls;
  const knowledge=await agentKnowledge(config,new AbortController().signal);
  assert.equal(embeddingCalls,before);assert.equal(knowledge.hits.length,0);assert.equal(knowledge.tools.length,2);
  assert.notEqual(knowledge.tools[0].name,knowledge.tools[1].name);
  assert.match(knowledge.tools[0].description,/cancelamento e devolução/);
  assert.match(knowledge.tools[1].description,/frete e prazo/);
  assert.doesNotMatch(knowledge.context,/sete dias|três dias/);
  await knowledge.tools[1].call({consulta:"Qual o frete?"});
  assert.equal(embeddingCalls,before+1);assert.deepEqual(knowledge.consulted.map(b=>b.baseId),[shipping.id]);
  assert.equal(knowledge.referenceHits.length,0);
  await knowledge.tools[0].call({consulta:"reembolso"});await knowledge.tools[0].call({consulta:"reembolso"});
  assert.equal(knowledge.hits.length,2);assert.equal(knowledge.referenceHits.length,1);assert.equal(knowledge.referenceHits[0].baseId,refunds.id);
  assert.match(knowledge.followupContext(),/sete dias/);
  for(const args of [null,{},[],{consulta:""},{consulta:4},{consulta:"reembolso",baseId:shipping.id}])await assert.rejects(knowledge.tools[0].call(args),/consulta/);
  const abort=new AbortController();const cancelled=await agentKnowledge(config,abort.signal);abort.abort();
  await assert.rejects(cancelled.tools[0].call({consulta:"reembolso"}),/abort/i);
});

for(const kind of ["agent","llm"] as const)test(`${kind}: ChatGPT recebe ferramentas e descrições, consulta somente a base escolhida e registra input/output`,async t=>{
  t.mock.method(chatGPT(),"account",async()=>({account:{type:"chatgpt",email:"fixture@example.com"},login:null,error:null}));
  let calls=0;
  t.mock.method(chatGPT(),"run",async(options:Parameters<ReturnType<typeof chatGPT>["run"]>[0])=>{
    calls++;assert.equal(options.webSearch,false);assert.equal(options.tools?.length,kind === "agent" ? 3 : 2);
    assert.doesNotMatch(options.prompt,/sete dias|três dias/);
    const tool=options.tools!.find(t=>t.description.includes("cancelamento e devolução"))!;
    assert.ok(tool);const data=JSON.parse(await tool.call({consulta:"prazo de reembolso"}));
    assert.match(data.trechos[0].conteudo,/sete dias/);assert.doesNotMatch(JSON.stringify(data),/três dias/);
    options.onUsage?.({input:50,output:10,total:60});
    return "O prazo de reembolso é sete dias.";
  });
  const f=flow(kind,{tools:"interno:data_hora"}),before=embeddingCalls;
  const run=await startRun(f.id,"Qual o prazo de reembolso?");
  assert.equal(run.status,"completed");assert.equal(calls,1);assert.equal(embeddingCalls,before+1);
  assert.match(run.output,/Manual Reembolsos/);assert.doesNotMatch(run.output,/Manual Entregas/);
  const tools=run.trace.filter(t=>t.type==="tool");assert.equal(tools.length,1);
  assert.equal(tools[0].label,"Conhecimento: Reembolsos");assert.equal(tools[0].status,"completed");assert.ok(tools[0].ms>=0);
  assert.match(tools[0].input!,/prazo de reembolso/);assert.match(tools[0].output,/sete dias/);
  const step=run.trace.find(t=>t.type==="step" && t.nodeId===f.graph.nodes[1].id)!;
  assert.equal(step.knowledge?.available?.length,2);assert.equal(step.knowledge?.count,1);assert.deepEqual(step.knowledge?.bases?.map(b=>b.baseId),[refunds.id]);
  const saved=flows.getRun(run.id).trace.find(t=>t.type==="step" && t.nodeId===f.graph.nodes[1].id)!;
  assert.equal(saved.knowledge?.chunks?.length,1);
  assert.equal(saved.knowledge?.chunks?.[0].pageContent,"O reembolso pode ser solicitado em sete dias.");
  assert.equal(saved.knowledge?.chunks?.[0].baseId,refunds.id);
  await flows.deleteFlow(f.id);
});

test("modelo pode consultar várias bases ou nenhuma; OpenRouter usa o ciclo real de tool calls",async t=>{
  setConfig("OPENROUTER_API_KEY","fixture");let mode:"both"|"none"="both",rounds=0;
  t.mock.method(globalThis,"fetch",async(target:string,options:RequestInit)=>{
    assert.equal(target,"https://openrouter.ai/api/v1/chat/completions");
    const payload=JSON.parse(String(options.body));rounds++;
    assert.equal(payload.tools.length,2);assert.match(payload.tools[0].function.description,/devolução/);
    const results=payload.messages.filter((m:{role:string})=>m.role==="tool");
    if(!results.length && mode==="both")return Response.json({choices:[{finish_reason:"tool_calls",message:{content:null,tool_calls:payload.tools.map((tool:{function:{name:string}},i:number)=>({id:`query${i}`,type:"function",function:{name:tool.function.name,arguments:JSON.stringify({consulta:i?"prazo de entrega":"reembolso"})}}))}}],usage:{prompt_tokens:50,completion_tokens:10,total_tokens:60}});
    if(mode==="both") {assert.equal(results.length,2);assert.match(results[0].content,/sete dias/);assert.match(results[1].content,/três dias/);}
    return Response.json({choices:[{finish_reason:"stop",message:{content:mode==="both"?"Reembolso em sete dias; entrega em três dias úteis.":"Olá!"}}],usage:{prompt_tokens:80,completion_tokens:20,total_tokens:100}});
  });
  try {
    for(const kind of ["agent","llm"] as const){
      const f=flow(kind,{model:"openrouter:fixture"});const before=embeddingCalls;rounds=0;mode="both";
      const result=await startRun(f.id,"Compare reembolso e prazo de entrega.");
      assert.equal(result.status,"completed");assert.equal(rounds,2);assert.equal(embeddingCalls,before+2);
      assert.equal(result.trace.filter(t=>t.type==="tool").length,2);assert.match(result.output,/Manual Reembolsos/);assert.doesNotMatch(result.output,/Manual Entregas/);
      assert.equal(result.trace.find(t=>t.knowledge)?.knowledge?.bases?.length,2);
      assert.deepEqual(result.trace.find(t=>t.knowledge)?.knowledge?.chunks?.map(c=>c.baseId),[refunds.id],"Não expõe chunks de bases com referências desativadas");
      mode="none";const next=embeddingCalls;const greeting=await startRun(f.id,"Olá");
      assert.equal(greeting.status,"completed");assert.equal(greeting.output,"Olá!");assert.equal(embeddingCalls,next);assert.equal(greeting.trace.filter(t=>t.type==="tool").length,0);
      await flows.deleteFlow(f.id);
    }
  } finally {setConfig("OPENROUTER_API_KEY",null);}
});

test("compatibilidade: seleção antiga também vira ferramenta; array vazio remove o vínculo antigo",async()=>{
  const before=embeddingCalls;
  const legacy=await agentKnowledge({knowledgeBase:refunds.id,knowledgeReferences:"true"},new AbortController().signal);
  assert.equal(embeddingCalls,before);assert.equal(legacy.tools.length,1);assert.match(legacy.tools[0].description,/cancelamento/);
  await legacy.tools[0].call({consulta:"reembolso"});assert.equal(legacy.referenceHits.length,1);
  const empty=await agentKnowledge({knowledgeBase:refunds.id,knowledgeBases:"[]"},new AbortController().signal);
  assert.equal(empty.tools.length,0);assert.equal(empty.context,"");
});

test("validação e vínculos incluem Agent/LLM em fluxos salvos e não publicados",async()=>{
  for(const kind of ["agent","llm"] as const){
    const f=flow(kind);assert.ok(store.knowledgeBaseUsages(refunds.id).some(x=>x.id===f.id));assert.ok(store.knowledgeBaseUsages(shipping.id).some(x=>x.id===f.id));
    await assert.rejects(runtime.deleteKnowledgeBase(shipping.id),/vinculada/);
    f.published=null;abrirBanco().prepare("UPDATE flows SET body=? WHERE id=?").run(JSON.stringify(f),f.id);
    assert.ok(store.knowledgeBaseUsages(shipping.id).some(x=>x.id===f.id));
    f.graph.nodes[1].data.config.knowledgeBases="[]";
    flows.saveFlow(f.id,{name:f.name,description:"",graph:f.graph});assert.ok(!store.knowledgeBaseUsages(shipping.id).some(x=>x.id===f.id));
    await flows.deleteFlow(f.id);
    for(const rows of [[{...bindings[0],description:""}],[{...bindings[0],description:"x".repeat(1001)}],[bindings[0],bindings[0]],[{...bindings[0],baseId:""}],[{...bindings[0],references:"true"}],[{...bindings[0],topK:0}],[{...bindings[0],minScore:"0"}],Array(11).fill(bindings[0])]){
      const graph=template();graph.nodes[1].data.kind=kind;graph.nodes[1].data.config.knowledgeBases=JSON.stringify(rows);
      assert.throws(()=>flows.validateGraph(graph));
    }
  }
  assert.throws(()=>knowledgeSettings({knowledgeBases:"{"}));
});

test("consulta sem resultados e erro de base indisponível ficam visíveis como resultado ou falha da ferramenta",async t=>{
  t.mock.method(chatGPT(),"account",async()=>({account:{type:"chatgpt",email:"fixture@example.com"},login:null,error:null}));
  const empty=await base("Sem resultados","Consultar dados financeiros.","Documento financeiro.");
  store.updateKnowledgeBase(empty.id,{config:{...empty.config,retrieval:{topK:4,minScore:0,metadataFilter:{missing:true}}}});
  const binding={baseId:empty.id,description:"Consultar dados financeiros.",references:true};
  let failed=false;
  t.mock.method(chatGPT(),"run",async(options:Parameters<ReturnType<typeof chatGPT>["run"]>[0])=>{
    if(failed)await assert.rejects(options.tools![0].call({consulta:"saldo"}),/indexada/);
    else assert.match(await options.tools![0].call({consulta:"saldo"}),/Nenhum trecho/);
    return "Não há informação disponível para responder.";
  });
  const f=flow("agent",{knowledgeBases:JSON.stringify([binding])});
  const none=await startRun(f.id,"Qual o saldo?");assert.equal(none.trace.find(t=>t.type==="tool")?.status,"completed");assert.doesNotMatch(none.output,/Referências/);
  store.touchKnowledgeBase(empty.id);failed=true;
  const failure=await startRun(f.id,"Qual o saldo?");assert.equal(failure.trace.find(t=>t.type==="tool")?.status,"failed");assert.doesNotMatch(failure.output,/Referências/);
  await flows.deleteFlow(f.id);await runtime.deleteKnowledgeBase(empty.id);
});
