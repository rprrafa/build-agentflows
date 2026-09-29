import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import type { IndexConfig } from "./knowledge-types";
const dir = mkdtempSync(join(tmpdir(), "knowledge-refinements-"));
process.env.DATA_DIR = dir;
const store = await import("./knowledge-store");
const runtime = await import("./knowledge-index");
const credentials = await import("./tool-credential-store");
const { postgresConnectionString, validatedPostgres, currentPostgresConnection } = await import("./knowledge-postgres");
const { validatedRetrieval, matchesMetadata } = await import("./knowledge-retrieval");
const { knowledgeSettings } = await import("./knowledge-settings");
const { agentKnowledge } = await import("./knowledge-agent");
const { DEFAULT_INDEX, DEFAULT_SPLITTER } = await import("./knowledge-types");
const { POST: queryApi } = await import("../app/api/knowledge/[id]/query/route");
let encoding = "", dimensions = 0, badEncoding = false;
const server = createServer(async (req, res) => {
  let raw = ""; for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  encoding = body.encoding_format; dimensions = body.dimensions;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: body.input.map((text: string, index: number) => {
    const vector = Array(body.dimensions || 3).fill(0); vector[0] = text.includes("B") ? 0.3 : 1; vector[1] = text.includes("B") ? 1 : 0.1;
    const bytes = Buffer.alloc(vector.length * 4); vector.forEach((n, i) => bytes.writeFloatLE(n, i * 4));
    return { index, embedding: body.encoding_format === "base64" ? (badEncoding ? "invalid!" : bytes.toString("base64")) : vector };
  }) }));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const url = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
test.after(() => { server.close(); server.closeAllConnections(); rmSync(dir, {recursive:true, force:true}); });
async function baseWithDocs(config?: Partial<IndexConfig>) {
  const b = store.createKnowledgeBase({name:"Base isolada"});
  store.updateKnowledgeBase(b.id, {config:{...structuredClone(DEFAULT_INDEX), embeddings:{provider:"openai",model:"test",url,apiKey:"fixture"},...config}});
  for (const [text, area] of [["Documento A", "vendas"], ["Documento B", "suporte"], ["Documento C", "suporte"]]) {
    const source = store.saveKnowledgeSource(b.id,{name:text,loader:"plain",config:{text},splitter:DEFAULT_SPLITTER,metadata:{area, nested:{active:true}}});
    await runtime.processKnowledgeSource(b.id,source.id);
  }
  await runtime.indexKnowledge(b.id);
  return store.getKnowledgeBase(b.id);
}

test("Top K herdado pelo teste, API e agente; alterações de busca não invalidam vetores", async () => {
  let base = await baseWithDocs(); const revision = base.revision;
  base = store.updateKnowledgeBase(base.id, {config:{...base.config,retrieval:{topK:1,minScore:0}}});
  assert.equal(base.revision,revision);assert.equal(base.status,"ready");
  assert.equal((await runtime.queryKnowledge(base.id,"consulta")).length,1);
  const response=await queryApi(new Request("http://local/query",{method:"POST",body:JSON.stringify({query:"consulta"})}),{params:Promise.resolve({id:base.id})});
  assert.equal(response.status,200);assert.equal((await response.json()).length,1);
  const inherited = await agentKnowledge({knowledgeBase:base.id},new AbortController().signal);
  assert.equal(inherited.hits.length,0);
  await inherited.tools[0].call({consulta:"consulta"});
  assert.equal(inherited.hits.length,1);
  const overridden = await agentKnowledge({knowledgeBase:base.id,knowledgeTopK:"2"},new AbortController().signal);
  await overridden.tools[0].call({consulta:"consulta"});
  assert.equal(overridden.hits.length,2);
  assert.equal(knowledgeSettings({}).topK,undefined);
  assert.equal((await runtime.queryKnowledge(base.id,"consulta",3)).length,3);
  base = store.updateKnowledgeBase(base.id,{config:{...base.config,retrieval:{topK:2,minScore:0,metadataFilter:'{"area":"suporte","nested":{"active":true}}'}}});
  assert.equal(base.revision,revision);assert.equal(base.status,"ready");
  const hits=await runtime.queryKnowledge(base.id,"consulta");assert.equal(hits.length,2);assert.ok(hits.every(h=>h.metadata.area==="suporte"));
  assert.throws(()=>store.updateKnowledgeBase(base.id,{config:{...base.config,retrieval:{topK:2,minScore:0,metadataFilter:"{"}}}),/JSON válido/);
  assert.equal(store.getKnowledgeBase(base.id).revision,revision);
});

test("Faiss isola bases e gerações, inclusive ao reindexar e excluir",async()=>{
  const a=await baseWithDocs(), b=await baseWithDocs();
  const pathA=runtime.knowledgeStorageLocation(a.id)!.location, pathB=runtime.knowledgeStorageLocation(b.id)!.location;
  assert.notEqual(pathA,pathB);assert.ok(existsSync(join(pathA,"index.faiss")));assert.ok(existsSync(join(pathB,"index.faiss")));
  await runtime.indexKnowledge(a.id);assert.notEqual(runtime.knowledgeStorageLocation(a.id)!.location,pathA);assert.equal(existsSync(pathA),false);
  await runtime.deleteKnowledgeBase(a.id);assert.ok(existsSync(pathB));assert.equal((await runtime.queryKnowledge(b.id,"consulta")).length,3);
});

test("filtros e limites recusam tipos ambíguos, operadores e protótipos",()=>{
  for(const value of [{topK:0},{topK:21},{topK:1.5},{topK:"4"},{minScore:NaN},{minScore:2},{metadataFilter:[]},{metadataFilter:{x:[]}}, {metadataFilter:{x:{$gt:1}}}, {metadataFilter:'{"__proto__":{"admin":true}}'}, {distanceStrategy:"bad"}]) assert.throws(()=>validatedRetrieval(value));
  assert.equal(matchesMetadata({}, {missing:null}),false);
  assert.equal(matchesMetadata({x:{active:true,extra:1}},{x:{active:true}}),true);
  assert.equal(matchesMetadata({x:1},{x:"1"}),false);
});

test("credencial PostgreSQL compartilhada, cifrada, rotacionável e protegida enquanto em uso",()=>{
  const cred=credentials.saveToolCredential({name:"Postgres",provider:"knowledge_postgres",fields:{KNOWLEDGE_POSTGRES_USER:"usuário@test",KNOWLEDGE_POSTGRES_PASSWORD:"senha:/@#?"}});
  const pg={host:"localhost",database:"base teste",port:5432,ssl:true,credentialId:cred.id};
  const connection=new URL(postgresConnectionString(pg));assert.equal(decodeURIComponent(connection.username),"usuário@test");assert.equal(decodeURIComponent(connection.password),"senha:/@#?");assert.equal(connection.searchParams.get("sslmode"),"verify-full");
  const base=store.createKnowledgeBase({name:"Postgres"});
  const saved=store.updateKnowledgeBase(base.id,{config:{...structuredClone(DEFAULT_INDEX),embeddings:{provider:"ollama",model:"test",url},vectorStore:{provider:"postgres",url:"",postgres:pg,options:{tableName:"docs",contentColumnName:"pageContent",batchSize:"2"}},recordManager:{provider:"postgres",postgres:pg}}});
  assert.doesNotMatch(JSON.stringify(saved),/senha|usuário/);assert.doesNotMatch(JSON.stringify(credentials.getToolCredential(cred.id)),/senha:\/|usuário/);
  assert.throws(()=>credentials.deleteToolCredential(cred.id),/em uso/);
  credentials.saveToolCredential({name:cred.name,fields:{KNOWLEDGE_POSTGRES_PASSWORD:"rotated"}},cred.id);
  assert.equal(new URL(store.indexKnowledgeConfig(base.id).vectorStore.connectionString!).password,"rotated");
  for(const bad of [{host:"localhost/path"},{host:"localhost?user=x"},{port:0},{queryTimeout:1},{credentialId:saved.config.embeddings.credentialId || "invalid"}]) assert.throws(()=>validatedPostgres({...pg,...bad}));
  const invalidOptions: Record<string,string>[] = [{tableName:"x;DROP"},{tableName:"a".repeat(23)},{contentColumnName:"metadata"},{contentColumnName:"x;DROP"},{batchSize:"0"}];
  for(const options of invalidOptions) assert.throws(()=>store.updateKnowledgeBase(base.id,{config:{...saved.config,vectorStore:{...saved.config.vectorStore,options}}}));
  const snapshot={postgres:pg,connectionString:postgresConnectionString(pg)};
  store.updateKnowledgeBase(base.id,{config:{...saved.config,vectorStore:{provider:"faiss",url:""},recordManager:{provider:"sqlite"}}});
  credentials.deleteToolCredential(cred.id);
  assert.equal(currentPostgresConnection(snapshot),snapshot.connectionString);
});

test("dimensões e base64 OpenAI alteram payload, leitura e reaproveitamento", async()=>{
  const base=await baseWithDocs({embeddings:{provider:"openai",model:"text-embedding-3-small",url,apiKey:"fixture",dimensions:2,encodingFormat:"base64"}});
  assert.equal(encoding,"base64");assert.equal(dimensions,2);
  assert.equal((await runtime.queryKnowledge(base.id,"consulta")).length,3);
  let saved=store.updateKnowledgeBase(base.id,{config:{...base.config,embeddings:{...base.config.embeddings,dimensions:3}}});
  assert.equal(saved.status,"dirty");const run=await runtime.indexKnowledge(base.id);assert.equal(run.run.embedded,3);assert.equal(run.run.reused,0);assert.equal(dimensions,3);
  saved=store.getKnowledgeBase(base.id);
  assert.throws(()=>store.updateKnowledgeBase(base.id,{config:{...saved.config,embeddings:{...saved.config.embeddings,dimensions:1537}}}),/Dimensões/);
  badEncoding=true;await assert.rejects(runtime.queryKnowledge(base.id,"consulta"),/base64 inválido/);badEncoding=false;
});

if (process.env.KNOWLEDGE_TEST_POSTGRES) test("Postgres real: tabela/coluna/lote, filtros, três estratégias, isolamento e limpeza",async()=>{
  const {Client}=await import("pg");const connectionString=process.env.KNOWLEDGE_TEST_POSTGRES!;
  const db=new Client({connectionString});await db.connect();await db.query("CREATE EXTENSION IF NOT EXISTS vector");
  const {writeVectorGeneration,queryVectorGeneration,deleteVectorGeneration,vectorStorageLocation}=await import("./knowledge-vectors");
  const {randomUUID}=await import("node:crypto");
  const scope={baseId:randomUUID(),generation:randomUUID(),dimensions:2}, other={...scope,baseId:randomUUID()};
  const config={provider:"postgres" as const,url:"",connectionString,options:{tableName:"refine_test",contentColumnName:"pageContent",batchSize:"2"}};
  const rows=[{id:"a",vector:[1,0],sourceId:"source",content:"A\0texto",metadata:{area:"sales"}},{id:"b",vector:[10,1],sourceId:"source",content:"B",metadata:{area:"support",nested:{active:true}}},{id:"c",vector:[0.5,0.1],sourceId:"source",content:"C",metadata:{area:"support",nested:{active:true}}}];
  const role = `refine_user_${randomUUID().slice(0,8)}`;
  await db.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'first-fixture'`);
  await db.query(`GRANT USAGE, CREATE ON SCHEMA public TO "${role}"`);
  let runtimeBase: Awaited<ReturnType<typeof baseWithDocs>> | undefined;
  try {
    const address = new URL(connectionString);
    const cred = credentials.saveToolCredential({name:"Postgres real",provider:"knowledge_postgres",fields:{KNOWLEDGE_POSTGRES_USER:role,KNOWLEDGE_POSTGRES_PASSWORD:"first-fixture"}});
    const postgres = {host:address.hostname,port:Number(address.port || 5432),database:address.pathname.slice(1),ssl:false,credentialId:cred.id,connectionTimeout:5000,queryTimeout:10000};
    runtimeBase = await baseWithDocs({vectorStore:{...config,connectionString:undefined,postgres},recordManager:{provider:"postgres",postgres,tableName:"refine_records"}});
    const revision=runtimeBase.revision;
    runtimeBase=store.updateKnowledgeBase(runtimeBase.id,{config:{...runtimeBase.config,retrieval:{topK:2,minScore:0,metadataFilter:{area:"suporte"},distanceStrategy:"innerProduct"}}});
    assert.equal(runtimeBase.revision,revision);assert.equal(runtimeBase.status,"ready");
    const hits=await runtime.queryKnowledge(runtimeBase.id,"consulta");assert.equal(hits.length,2);assert.ok(hits.every(h=>h.metadata.area==="suporte"));
    const oldLocation=runtime.knowledgeStorageLocation(runtimeBase.id)!.location;
    await db.query(`ALTER ROLE "${role}" PASSWORD 'rotated-fixture'`);
    credentials.saveToolCredential({name:cred.name,fields:{KNOWLEDGE_POSTGRES_PASSWORD:"rotated-fixture"}},cred.id);
    const reindexed=await runtime.indexKnowledge(runtimeBase.id);assert.equal(reindexed.run.reused,3);
    assert.equal((await db.query("SELECT to_regclass($1) AS name",[oldLocation])).rows[0].name,null);
    assert.deepEqual(await runtime.cleanupKnowledge(runtimeBase.id),{pending:0});
    await writeVectorGeneration(config,scope,rows);await writeVectorGeneration(config,other,rows.slice(0,1));
    const table=vectorStorageLocation(config,scope)!.location;
    assert.equal((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count,"3");
    assert.equal((await db.query(`SELECT "pageContent" FROM ${table} WHERE id='a'`)).rows[0].pageContent,"Atexto");
    assert.deepEqual(await queryVectorGeneration(config,scope,[1,0],1,undefined,{distanceStrategy:"cosine"}),["a"]);
    assert.deepEqual(await queryVectorGeneration(config,scope,[1,0],1,undefined,{distanceStrategy:"euclidean"}),["a"]);
    assert.deepEqual(await queryVectorGeneration(config,scope,[1,0],1,undefined,{distanceStrategy:"innerProduct"}),["b"]);
    assert.deepEqual(await queryVectorGeneration(config,scope,[1,0],2,undefined,{metadataFilter:{area:"support",nested:{active:true}}}),["b","c"]);
    assert.deepEqual(await queryVectorGeneration(config,scope,[1,0],2,undefined,{metadataFilter:{area:"' OR 1=1--"}}),[]);
    await deleteVectorGeneration(config,scope);assert.equal((await queryVectorGeneration(config,other,[1,0],5)).length,1);
  } finally {if(runtimeBase) await runtime.deleteKnowledgeBase(runtimeBase.id);await deleteVectorGeneration(config,scope);await deleteVectorGeneration(config,other);await db.query("DROP TABLE IF EXISTS refine_records");await db.query(`DROP OWNED BY "${role}"`);await db.query(`DROP ROLE "${role}"`);await db.end();}
});
