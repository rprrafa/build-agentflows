import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir=mkdtempSync(join(tmpdir(),"account-profile-"));process.env.DATA_DIR=dir;
const {criarConta,entrar,sair}=await import("./conta");
const {GET}=await import("../app/api/conta/perfil/route");
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test("perfil exige sessão, retorna apenas o nome e deixa de responder após logout",async()=>{
  assert.equal((await GET(new Request("http://localhost/api/conta/perfil"))).status,401);
  criarConta({nome:"Rafael Teste",email:"rafael@example.com",senha:"Teste-Seguro-2026!"});
  const {token}=entrar({email:"rafael@example.com",senha:"Teste-Seguro-2026!"});
  const req=new Request("http://localhost/api/conta/perfil",{headers:{cookie:`sessao=${token}`}});
  const response=await GET(req);assert.deepEqual(await response.json(),{usuario:{nome:"Rafael Teste"}});assert.match(response.headers.get("cache-control")!,/no-store/);
  sair(token);assert.equal((await GET(req)).status,401);
});
