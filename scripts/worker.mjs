import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { saasDatabase } from "../lib/saas-db.ts";
import { migrateDatabase } from "../lib/db/migrate.ts";
import { claimJob, recoverExpiredJobs } from "../lib/saas-jobs.ts";
import { runClaimedJob } from "../lib/saas-worker.ts";
import { nextJobNotification, closeQueue } from "../lib/saas-queue.ts";
import { deliverAuthMail } from "../lib/saas-mail.ts";
import { cleanupAuth } from "../lib/saas-auth.ts";

const db = saasDatabase(), id = randomUUID(), stop = new AbortController();
const active = new Set();
let mail = Promise.resolve(), sendingMail = false, lastMaintenance = 0;
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop.abort());
await migrateDatabase(db);
writeFileSync(path.join(tmpdir(), "agentflows-worker-id"), id, { mode: 0o600 });
try {
  while (!stop.signal.aborted) {
    try {
      await db.query("INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET updated_at=now()", [id]);
      await recoverExpiredJobs(db);
      if (Date.now() - lastMaintenance > 60000) {
        lastMaintenance = Date.now(); await cleanupAuth(db);
        await db.query("DELETE FROM worker_heartbeats WHERE updated_at<now()-interval '1 day'");
        await db.query("DELETE FROM jobs WHERE finished_at<now()-interval '7 days' AND status NOT IN ('queued','running')");
      }
      if (!sendingMail && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
        sendingMail = true;
        mail = deliverAuthMail(db).catch(() => console.error("Não foi possível processar a fila de e-mails."))
          .finally(() => { sendingMail = false; });
      }
      if (active.size < 2) {
        const job = await claimJob(db, await nextJobNotification() || undefined);
        if (job) {
          const work = runClaimedJob(db, job, stop.signal).catch(() => console.error("Falha ao finalizar job; a recuperação verificará a autorização expirada."))
            .finally(() => active.delete(work));
          active.add(work);
        }
      }
    } catch { console.error("Worker aguardando recuperação da infraestrutura."); }
    await new Promise((resolve) => { const timer = setTimeout(done, 1000); function done() { clearTimeout(timer); stop.signal.removeEventListener("abort", done); resolve(); } stop.signal.addEventListener("abort", done, { once: true }); if (stop.signal.aborted) done(); });
  }
} finally {
  const deadline = setTimeout(() => process.exit(1), 55000); deadline.unref();
  await Promise.allSettled([...active, mail]);
  await db.query("DELETE FROM worker_heartbeats WHERE id=$1", [id]);
  closeQueue(); await db.close(); clearTimeout(deadline);
}
