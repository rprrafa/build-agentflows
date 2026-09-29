import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTenantTestContext } from "../scripts/tenant-test-context";
import { hashToken, randomToken } from "./saas-security";
import { withTenantSession } from "./tenant-context";
import { getConfig } from "./store";
import { GET as begin } from "../app/api/conexoes/openrouter/route";
import { GET as complete } from "../app/api/conexoes/openrouter/callback/route";

test("OAuth privado fixa a origem, exige estado do dono e grava a credencial só uma vez", async (t) => {
  const tenant = await createTenantTestContext();
  t.after(tenant.close);
  const other = randomUUID(), otherToken = randomToken();
  await tenant.db.query("INSERT INTO users(id,name,email,email_verified_at,beta_status) VALUES($1,'Other',$2,now(),'approved')", [other, `${other}@example.com`]);
  await tenant.db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hashToken(otherToken), other]);
  const response = await tenant.connect(() => begin(tenant.request("/api/conexoes/openrouter", {
    headers: { host: "attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" },
  })));
  assert.equal(response.status, 302);
  const provider = new URL(response.headers.get("location")!);
  const callback = new URL(provider.searchParams.get("callback_url")!);
  assert.equal(callback.origin, "https://app.example.com");
  assert.ok(callback.searchParams.get("state"));
  const verifierCookie = response.headers.get("set-cookie")!.split(";")[0];
  assert.ok(response.headers.get("set-cookie")!.includes("Secure"));
  let exchanges = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/auth/keys");
    exchanges++;
    return Response.json({ key: "private-openrouter-key" });
  });
  async function finish(token: string, state: string | null) {
    const url = new URL(callback);
    url.searchParams.set("code", "provider-code");
    if (state === null) url.searchParams.delete("state");
    else url.searchParams.set("state", state);
    const req = tenant.request(url.pathname + url.search);
    req.headers.set("cookie", `agentflows_session=${token}; ${verifierCookie}`);
    return tenant.connect(() => complete(req));
  }
  const state = callback.searchParams.get("state")!;
  for (const [token, supplied] of [[tenant.token, null], [otherToken, state]] as const) {
    assert.match((await finish(token, supplied)).headers.get("location")!, /erro=/);
  }
  assert.equal(exchanges, 0);
  assert.match((await finish(tenant.token, state)).headers.get("location")!, /conectado=openrouter/);
  assert.equal(exchanges, 1);
  assert.equal(await tenant.asTenant(() => getConfig("OPENROUTER_API_KEY")), "private-openrouter-key");
  assert.equal(await withTenantSession(tenant.db, otherToken, () => getConfig("OPENROUTER_API_KEY")), undefined);
  assert.match((await finish(tenant.token, state)).headers.get("location")!, /erro=/);
  assert.equal(exchanges, 1, "estado consumido não repete a troca externa");
});
