import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "./flow-types";
import { parseRunPage } from "./run-page";
const dir=mkdtempSync(join(tmpdir(),"run-pagination-"));process.env.DATA_DIR=dir;
const {putRun,listRunPage,getRun}=await import("./flow-store");
const {GET}=await import("../app/api/runs/route");
const {template}=await import("./flow-types");
test.after(()=>rmSync(dir,{recursive:true,force:true}));
for(let i=0;i<135;i++) putRun({id:`run-${i}`,flowId:i%2 ? "b":"a",name:`Execução ${i}`,status:i%3 ? "completed":"failed",version:1,demo:true,input:"Entrada ".repeat(1000),output:"Saída pesada ".repeat(1000),graph:template(),state:{secret:"dados volumosos"},outputs:{},visits:{},trace:[],next:null,createdAt:new Date(1700000000000+i*1000).toISOString(),updatedAt:""} satisfies Run);
test("paginação acessa mais de 100 execuções sem duplicar registros ou enviar conteúdo pesado", async()=>{
  const seen:string[]=[];
  for(let page=1;page<=7;page++){
    const response=await GET(new Request(`http://localhost/api/runs?page=${page}&pageSize=20`));assert.equal(response.status,200);
    const data=parseRunPage(await response.json());assert.equal(data.total,135);assert.equal(data.totalPages,7);assert.ok(data.items.length<=20);
    for(const r of data.items){seen.push(r.id);assert.ok(r.input.length<=100);for(const key of ["graph","output","trace","state"]) assert.equal(key in r,false);}
  }
  assert.equal(new Set(seen).size,135);assert.equal(seen[0],"run-134");assert.equal(seen.at(-1),"run-0");
  assert.ok(getRun("run-0").input.length>100);
});
test("filtro no servidor, fluxo, tamanho, última página e resultado vazio preservam totais corretos",()=>{
  const failed=listRunPage({pageSize:20,status:"failed"});assert.equal(failed.total,45);assert.equal(failed.totalPages,3);assert.ok(failed.items.every(r=>r.status==="failed"));
  const combined=listRunPage({flowId:"a",status:"failed",pageSize:10});assert.equal(combined.total,23);assert.ok(combined.items.every(r=>r.flowId==="a"));
  const last=listRunPage({page:999,pageSize:50});assert.equal(last.page,3);assert.equal(last.items.length,35);
  const empty=listRunPage({status:"waiting"});assert.equal(empty.total,0);assert.equal(empty.page,1);assert.deepEqual(empty.items,[]);
});
test("parâmetros inválidos são recusados e o contrato anterior do editor é preservado",async()=>{
  for(const query of ["page=0","page=-1","page=abc","page=1.1","pageSize=1000000","pageSize=0","status=invalid"]){assert.equal((await GET(new Request(`http://localhost/api/runs?${query}`))).status,400);}
  const legacy=await(await GET(new Request("http://localhost/api/runs?flowId=b"))).json();assert.ok(Array.isArray(legacy));assert.ok(legacy[0].graph);
});
