import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import type { IndexConfig } from "./knowledge-types";
const dir = mkdtempSync(join(tmpdir(), "knowledge-cleanup-"));
process.env.DATA_DIR = dir;
const store = await import("./knowledge-store");
const runtime = await import("./knowledge-index");
const { DEFAULT_INDEX, DEFAULT_SPLITTER } = await import("./knowledge-types");
let fail = false, calls = 0;
const server = createServer(async (req, res) => {
  let raw = ""; for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  res.setHeader("Content-Type", "application/json");
  if (fail) { res.statusCode = 503; res.end("{}"); return; }
  calls += body.input.length;
  res.end(JSON.stringify({data:body.input.map((_:string,index:number)=>({index,embedding:[1,0.1,0]}))}));
});
server.listen(0,"127.0.0.1"); await once(server,"listening");
const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
test.after(()=>{server.close();server.closeAllConnections();rmSync(dir,{recursive:true,force:true});});
const providers: IndexConfig["recordManager"][] = [{provider:"sqlite"}];
if(process.env.KNOWLEDGE_TEST_POSTGRES) providers.push({provider:"postgres",connectionString:process.env.KNOWLEDGE_TEST_POSTGRES,tableName:"cleanup_test_records"});
async function fixture(record:IndexConfig["recordManager"]) {
  const base=store.createKnowledgeBase({name:"Limpeza"});
  store.updateKnowledgeBase(base.id,{config:{...structuredClone(DEFAULT_INDEX),embeddings:{provider:"openai",model:"fixture",url,apiKey:"fixture"},recordManager:record}});
  for(const [name,text] of [["A","Texto A original"],["B","Texto B original"]]) {
    const source=store.saveKnowledgeSource(base.id,{name,loader:"plain",config:{text},splitter:DEFAULT_SPLITTER,metadata:{source:name}});
    await runtime.processKnowledgeSource(base.id,source.id);
  }
  await runtime.indexKnowledge(base.id);
  return base.id;
}
function settings(id:string,values:Partial<IndexConfig["recordManager"]>) {
  const base=store.getKnowledgeBase(id);
  return store.updateKnowledgeBase(id,{config:{...base.config,recordManager:{...base.config.recordManager,...values}}});
}
async function texts(id:string) {return (await runtime.queryKnowledge(id,"consulta",20,-1)).map(hit=>hit.pageContent).sort();}
for (const provider of providers) {
  test(`${provider.provider}: nenhuma preserva versões editadas, sem duplicar ao repetir; completa limpa`,async()=>{
    const id=await fixture({...provider,cleanup:"none"});
    const other=await fixture(provider);
    try {
      const oldPath=runtime.knowledgeStorageLocation(id)!.location;
      const a=store.listKnowledgeChunks(id)[0];
      store.editKnowledgeChunk(id,a.id,{...a,pageContent:"Texto A novo"});
      const updated=await runtime.indexKnowledge(id);
      assert.equal(updated.run.total,3);assert.equal(updated.base.indexedChunks,3);
      assert.equal(updated.run.embedded,1);assert.equal(updated.run.reused,2);
      assert.equal(existsSync(oldPath),false);
      assert.deepEqual(await texts(id),["Texto A novo","Texto A original","Texto B original"]);
      const repeat=await runtime.indexKnowledge(id);
      assert.equal(repeat.run.total,3);assert.equal(repeat.run.embedded,0);
      assert.equal(new Set((await runtime.queryKnowledge(id,"consulta",20,-1)).map(x=>x.id)).size,3);
      assert.deepEqual(await texts(other),["Texto A original","Texto B original"]);
      settings(id,{cleanup:"full"});await runtime.indexKnowledge(id);
      assert.deepEqual(await texts(id),["Texto A novo","Texto B original"]);
      for(const chunk of store.listKnowledgeChunks(id))store.editKnowledgeChunk(id,chunk.id,null);
      await runtime.indexKnowledge(id);const before=calls;
      assert.deepEqual(await texts(id),[]);assert.equal(calls,before);
      assert.equal(store.getKnowledgeBase(id).indexedChunks,0);
    } finally {await runtime.deleteKnowledgeBase(id);await runtime.deleteKnowledgeBase(other);}
  });
  test(`${provider.provider}: incremental substitui fonte presente, preserva ausente e exclusão explícita purga`,async()=>{
    const id=await fixture({...provider,cleanup:"incremental"});
    try {
      const [a,b]=store.listKnowledgeChunks(id);
      store.editKnowledgeChunk(id,a.id,{...a,pageContent:"Texto A novo"});
      store.editKnowledgeChunk(id,b.id,null);
      const result=await runtime.indexKnowledge(id);assert.equal(result.run.total,2);
      assert.deepEqual(await texts(id),["Texto A novo","Texto B original"]);
      await runtime.removeKnowledgeSource(id,b.sourceId);await runtime.indexKnowledge(id);
      assert.deepEqual(await texts(id),["Texto A novo"]);
    } finally {await runtime.deleteKnowledgeBase(id);}
  });
  test(`${provider.provider}: chave de metadados distingue documentos da mesma fonte e rejeita chave ausente`,async()=>{
    const id=await fixture({...provider,cleanup:"incremental",sourceIdKey:"source"});
    try {
      const [a,b]=store.listKnowledgeChunks(id);
      // Two documents loaded by one source; only document A is in the next extraction.
      await store.withKnowledgeLock(id,async token=>store.replaceKnowledgeChunks(id,a.sourceId,[a,{...b,sourceId:a.sourceId,id:"b-same-source"}],token));
      await runtime.removeKnowledgeSource(id,b.sourceId);await runtime.indexKnowledge(id);
      await store.withKnowledgeLock(id,async token=>store.replaceKnowledgeChunks(id,a.sourceId,[{...a,pageContent:"Texto A novo"}],token));
      await runtime.indexKnowledge(id);
      assert.deepEqual(await texts(id),["Texto A novo","Texto B original"]);
      const published=runtime.knowledgeStorageLocation(id)!.location;
      const current=store.listKnowledgeChunks(id)[0];
      store.editKnowledgeChunk(id,current.id,{...current,metadata:{}});
      await assert.rejects(runtime.indexKnowledge(id),/metadado “source”/);
      assert.equal(runtime.knowledgeStorageLocation(id)!.location,published);assert.ok(existsSync(published));
      settings(id,{sourceIdKey:""});await runtime.indexKnowledge(id);
      assert.deepEqual(await texts(id),["Texto A novo"]);
    } finally {await runtime.deleteKnowledgeBase(id);}
  });
}
test("configuração legada usa completa; valida e persiste modo/chave",async()=>{
  const id=await fixture({provider:"sqlite"});
  try {
    assert.equal(store.getKnowledgeBase(id).config.recordManager.cleanup,"full");
    for (const cleanup of ["other",null,42]) assert.throws(()=>settings(id,{cleanup:cleanup as "full"}),/limpeza/);
    for (const sourceIdKey of [42,{},"a".repeat(201),"__proto__"])assert.throws(()=>settings(id,{sourceIdKey:sourceIdKey as string}),/chave/);
    settings(id,{cleanup:"incremental",sourceIdKey:" source "});
    assert.equal(store.getKnowledgeBase(id).config.recordManager.sourceIdKey,"source");
  } finally {await runtime.deleteKnowledgeBase(id);}
});
test("retenção reembeda conteúdo antigo ao trocar modelo e falha não publica geração parcial",async()=>{
  const id=await fixture({provider:"sqlite",cleanup:"none"});
  try {
    const a=store.listKnowledgeChunks(id)[0];store.editKnowledgeChunk(id,a.id,{...a,pageContent:"Texto A novo"});
    const base=store.getKnowledgeBase(id);
    store.updateKnowledgeBase(id,{config:{...base.config,embeddings:{...base.config.embeddings,model:"fixture-v2"}}});
    const published=runtime.knowledgeStorageLocation(id)!.location;
    fail=true;await assert.rejects(runtime.indexKnowledge(id));fail=false;
    assert.equal(runtime.knowledgeStorageLocation(id)!.location,published);assert.ok(existsSync(published));
    const result=await runtime.indexKnowledge(id);assert.equal(result.run.embedded,3);assert.equal(result.run.reused,0);
    assert.deepEqual(await texts(id),["Texto A novo","Texto A original","Texto B original"]);
  } finally {fail=false;await runtime.deleteKnowledgeBase(id);}
});

if (process.env.KNOWLEDGE_TEST_POSTGRES) test("Faiss → Postgres → exclusão limpa o histórico local, inclusive limpeza pendente, e preserva outras bases",async()=>{
  const {Client}=await import("pg");
  const {chmodSync}=await import("node:fs");
  const db=new Client({connectionString:process.env.KNOWLEDGE_TEST_POSTGRES});await db.connect();await db.query("CREATE EXTENSION IF NOT EXISTS vector");
  const other=await fixture({provider:"sqlite"});
  const otherPath=runtime.knowledgeStorageLocation(other)!.location;
  try {
    for (const scenario of ["before-index","normal","pending"] as const) {
      const id=await fixture({provider:"sqlite"});
      const path=runtime.knowledgeStorageLocation(id)!.location;
      let pgTable:string|undefined;
      try {
        const base=store.getKnowledgeBase(id);
        store.updateKnowledgeBase(id,{config:{...base.config,vectorStore:{provider:"postgres",url:"",connectionString:process.env.KNOWLEDGE_TEST_POSTGRES}}});
        if(scenario==="pending") chmodSync(path,0o500);
        if(scenario!=="before-index") {
          await runtime.indexKnowledge(id);pgTable=runtime.knowledgeStorageLocation(id)!.location;
          assert.deepEqual(await texts(id),["Texto A original","Texto B original"]);
          if(scenario==="normal") assert.equal(existsSync(path),false);
          else {
            assert.ok(existsSync(path));
            assert.deepEqual(await runtime.cleanupKnowledge(id),{pending:1});
            // A failed deletion keeps the base/history available for retry.
            await assert.rejects(runtime.deleteKnowledgeBase(id));
            assert.equal(store.getKnowledgeBase(id).id,id);
            chmodSync(path,0o700);
          }
        }
        await runtime.deleteKnowledgeBase(id);
        assert.equal(existsSync(path),false);
        assert.equal(store.knowledgeDb().prepare("SELECT count(*) AS n FROM knowledge_cleanup WHERE base_id=?").get(id)?.n,0);
        assert.equal(store.knowledgeDb().prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE base_id=?").get(id)?.n,0);
        if(pgTable)assert.equal((await db.query("SELECT to_regclass($1) AS name",[pgTable])).rows[0].name,null);
        assert.ok(existsSync(join(otherPath,"index.faiss")));
        assert.deepEqual(await texts(other),["Texto A original","Texto B original"]);
      } finally {
        if(existsSync(path)) chmodSync(path,0o700);
        if(store.knowledgeDb().prepare("SELECT id FROM knowledge_bases WHERE id=?").get(id))await runtime.deleteKnowledgeBase(id);
      }
    }
  } finally {await runtime.deleteKnowledgeBase(other);await db.query("DROP TABLE IF EXISTS cleanup_test_records");await db.end();}
});
