import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { saasDatabase } from "../lib/saas-db.ts";

let db;
try {
  const id = readFileSync(path.join(tmpdir(), "agentflows-worker-id"), "utf8").trim();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid worker ID");
  db = saasDatabase();
  const { rows } = await db.query("SELECT id FROM worker_heartbeats WHERE id=$1 AND updated_at>now()-interval '45 seconds'", [id]);
  process.exitCode = rows.length ? 0 : 1;
} catch { process.exitCode = 1; }
finally { await db?.close(); }
