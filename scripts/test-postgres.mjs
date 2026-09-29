// Builds a disposable cluster; never connects to the application's database.
// PG_BIN_DIR=/path/to/postgres/bin npm run test:postgres
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const bin = process.env.PG_BIN_DIR;
if (!bin) throw new Error("Defina PG_BIN_DIR para o diretório dos executáveis PostgreSQL de teste.");
const dir = await mkdtemp(path.join(tmpdir(), "agentflows-postgres-test-"));
const data = path.join(dir, "data"), pwfile = path.join(dir, "password");
const password = randomBytes(32).toString("hex");
const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
let started = false;
async function command(executable, args, options = {}) {
  const child = spawn(executable, args, { stdio: "ignore", ...options });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${path.basename(executable)} terminou com código ${code}.`);
}
try {
  await writeFile(pwfile, password, { mode: 0o600 });
  await command(path.join(bin, "initdb"), ["-D", data, "--username=af_test", "--auth=scram-sha-256", "--pwfile=" + pwfile, "--encoding=UTF8", "--locale=C"]);
  await writeFile(path.join(data, "postgresql.auto.conf"), `listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories=''\nmax_connections=50\nshared_buffers='32MB'\n`);
  await command(path.join(bin, "pg_ctl"), ["-D", data, "-l", path.join(dir, "postgres.log"), "-w", "start"]);
  started = true;
  const files = (await readdir("lib")).filter((name) => /^saas-.*\.test\.ts$/.test(name)).map((name) => `lib/${name}`);
  await command(process.execPath, ["--import", "./scripts/gancho-ts.mjs", "--test", ...files], {
    stdio: "inherit", env: { ...process.env, SAAS_TEST_DATABASE_URL: `postgresql://af_test:${password}@127.0.0.1:${port}/postgres` },
  });
  console.log("PostgreSQL servidor: suíte tenant passou com conexões concorrentes e bancos isolados.");
} finally {
  if (started) await command(path.join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
  await rm(dir, { recursive: true, force: true });
}
