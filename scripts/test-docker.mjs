// Isolated Compose smoke test. Never reads the application's .env or volumes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const docker = process.env.DOCKER_BIN || "docker";
const project = `agentflows-test-${randomBytes(6).toString("hex")}`;
const image = process.env.AGENTFLOWS_TEST_IMAGE || `${project}:local`;
const dir = await mkdtemp(path.join(tmpdir(), project));
const envFile = path.join(dir, "test.env"), override = path.join(dir, "compose.yml");
const env = { ...process.env, PATH: `${path.dirname(docker)}:${process.env.PATH}` };
// Compose interpolation must not inherit real credentials from the host.
for (const key of ["APP_URL", "CHAVE_MESTRA", "POSTGRES_PASSWORD", "REDIS_PASSWORD", "RESEND_API_KEY", "RESEND_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete env[key];
async function command(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${args[0]} failed (${code}): ${stderr.slice(-5000)}${stdout.slice(-2000)}`)));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const composeArgs = ["compose", "--env-file", envFile, "-p", project, "-f", path.resolve("docker-compose.coolify.yml"), "-f", override];
const compose = (...args) => command([...composeArgs, ...args]);
const inside = (source) => command([...composeArgs, "exec", "-T", "app", "node", "--import", "./scripts/gancho-ts.mjs", "--input-type=module", "-"], source);
const common = `
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { saasDatabase } from './lib/saas-db.ts';
const db = saasDatabase();
async function request(token, pathname, data, method) {
  const response = await fetch('http://127.0.0.1:10000' + pathname, {
    method: method || (data ? 'POST' : 'GET'),
    headers: { cookie: 'agentflows_session=' + token, origin: process.env.APP_URL, 'content-type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
`;
try {
  await writeFile(envFile, `APP_URL=https://app.example.test\nCHAVE_MESTRA=${randomBytes(32).toString("base64")}\nPOSTGRES_PASSWORD=${randomBytes(32).toString("hex")}\nREDIS_PASSWORD=${randomBytes(32).toString("hex")}\nRESEND_API_KEY=unused\nRESEND_FROM=test@example.com\n`, { mode: 0o600 });
  await writeFile(override, `services:\n  app:\n    image: ${image}\n    environment:\n      RESEND_API_KEY: ""\n      RESEND_FROM: ""\n  worker:\n    image: ${image}\n    environment:\n      RESEND_API_KEY: ""\n      RESEND_FROM: ""\n`);
  if (!process.env.AGENTFLOWS_TEST_IMAGE) {
    console.log("Docker: compiling image...");
    await command(["build", "-t", image, "."]);
  }
  console.log("Docker: starting isolated app, PostgreSQL and Redis...");
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "180", "app");
  await inside(common + `
    import { randomUUID } from 'node:crypto';
    import { hashToken, randomToken, seal } from './lib/saas-security.ts';
    import { block } from './lib/flow-types.ts';
    const { default: { IndexFlatIP } } = await import('faiss-node');
    const index = new IndexFlatIP(2);
    index.add([1, 0]);
    assert.equal(index.search([1, 0], 1).labels[0], 0);
    const a = randomUUID(), b = randomUUID(), tokenA = randomToken(), tokenB = randomToken();
    for (const [id, token] of [[a, tokenA], [b, tokenB]]) {
      await db.query("INSERT INTO users(id,name,email,email_verified_at,beta_status) VALUES($1,'Docker test',$2,now(),'approved')", [id, id + '@example.com']);
      await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hashToken(token), id]);
    }
    const nodes = [block('start', 'start', 0, 0), block('end', 'end', 200, 0)];
    nodes[1].data.config.text = 'Worker completed';
    const flow = await request(tokenA, '/api/flows', { name: 'Docker flow', description: '', graph: { nodes, edges: [{ id: 'edge', source: 'start', target: 'end' }] } });
    assert.equal(flow.status, 200);
    assert.equal((await request(tokenB, '/api/flows/' + flow.body.id)).status, 404);
    assert.equal((await request('', '/api/flows')).status, 401);
    const configured = await request(tokenA, '/api/conexoes', { campos: { REPLICATE_API_TOKEN: 'container-private-replicate-token' } }, 'PUT');
    assert.equal(configured.status, 200);
    assert.ok(!JSON.stringify(configured.body).includes('container-private-replicate-token'));
    assert.equal((await request(tokenA, '/api/conexoes/media')).body.providers.find(item => item.id === 'replicate').conectado, true);
    assert.equal((await request(tokenB, '/api/conexoes/media')).body.providers.some(item => item.conectado), false);
    const { default: sharp } = await import('sharp');
    const { withTenantJob } = await import('./lib/tenant-context.ts');
    const { saveAttachment } = await import('./lib/attachment-service.ts');
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
    const image = await withTenantJob(db, a, () => saveAttachment(flow.body.id, new File([png], 'generated.png'), true));
    assert.equal((await request(tokenB, '/api/attachments/' + image.id)).status, 404);
    const runs = [];
    for (let i=0; i<10; i++) {
      const run = await request(tokenA, '/api/flows/' + flow.body.id + '/run', { input: 'Test ' + i, demo: true });
      assert.equal(run.status, 202); runs.push(run.body.id);
    }
    assert.equal((await request(tokenA, '/api/flows/' + flow.body.id + '/run', { input: 'Over quota', demo: true })).status, 429);
    assert.equal((await request(tokenB, '/api/runs/' + runs[0])).status, 404);
    await writeFile('/app/data/docker-test.json', JSON.stringify({ a, b, tokenA, tokenB, runs, flowId: flow.body.id, imageId: image.id, png: png.toString('base64'), encrypted: seal('persisted-secret', 'docker-test') }), { mode: 0o600 });
    await db.close();
  `);
  console.log("Docker: checking two workers against the same queue...");
  await compose("up", "-d", "--no-build", "--scale", "worker=2", "--wait", "--wait-timeout", "180", "worker");
  await inside(common + `
    const fixture = JSON.parse(await readFile('/app/data/docker-test.json', 'utf8'));
    const deadline = Date.now() + 60000;
    let done = false;
    while (Date.now() < deadline) {
      const active = await db.query("SELECT count(*)::int count FROM jobs WHERE user_id=$1 AND status='running'", [fixture.a]);
      assert.ok(active.rows[0].count <= 1);
      const rows = (await db.query("SELECT status FROM jobs WHERE user_id=$1", [fixture.a])).rows;
      if (rows.length === 10 && rows.every(row => row.status === 'done')) { done = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(done, 'workers did not finish the persisted queue');
    for (const id of fixture.runs) assert.equal((await request(fixture.tokenA, '/api/runs/' + id)).body.status, 'completed');
    await db.close();
  `);
  console.log("Docker: recreating containers while retaining volumes...");
  await compose("down");
  await compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "180");
  await inside(common + `
    import { unseal } from './lib/saas-security.ts';
    const fixture = JSON.parse(await readFile('/app/data/docker-test.json', 'utf8'));
    assert.equal(unseal(fixture.encrypted, 'docker-test'), 'persisted-secret');
    assert.equal((await request(fixture.tokenA, '/api/flows/' + fixture.flowId)).status, 200);
    assert.equal((await request(fixture.tokenB, '/api/flows/' + fixture.flowId)).status, 404);
    assert.equal((await request(fixture.tokenA, '/api/conexoes/media')).body.providers.find(item => item.id === 'replicate').conectado, true);
    assert.equal((await request(fixture.tokenB, '/api/conexoes/media')).body.providers.some(item => item.conectado), false);
    const image = await fetch('http://127.0.0.1:10000/api/attachments/' + fixture.imageId, { headers: { cookie: 'agentflows_session=' + fixture.tokenA } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), fixture.png);
    assert.equal((await request(fixture.tokenB, '/api/attachments/' + fixture.imageId)).status, 404);
    for (const id of fixture.runs) assert.equal((await request(fixture.tokenA, '/api/runs/' + id)).body.status, 'completed');
    assert.equal((await db.query("SELECT count(*)::int count FROM jobs WHERE status='done'")).rows[0].count, 10);
    await db.close();
  `);
  const status = (await compose("ps", "--format", "json")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(status.length, 4);
  assert.ok(status.every((service) => service.Health === "healthy"));
  console.log("Docker passed: authenticated API, private media credentials/images, isolation, queue capacity, two workers, restart and volumes.");
} finally {
  try { await compose("down", "--volumes", "--remove-orphans"); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
