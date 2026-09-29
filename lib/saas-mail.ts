import { randomUUID } from "node:crypto";
import type { Database, Sql } from "./saas-db";
import { appOrigin, seal, unseal } from "./saas-security";

type Mail = { to: string; subject: string; text: string };

/** Written in the same transaction as the account/token. A provider outage cannot lose the email. */
export async function enqueueAuthMail(sql: Sql, email: string, purpose: "verify_email" | "reset_password", token: string) {
  const id = randomUUID();
  const verify = purpose === "verify_email";
  const link = new URL(verify ? "/verificar-email" : "/redefinir-senha", appOrigin());
  // Fragment is not sent to access logs, referrers or email link preview GETs.
  link.hash = new URLSearchParams({ token }).toString();
  const mail: Mail = {
    to: email,
    subject: verify ? "Confirme seu e-mail · Build Agentflows" : "Redefina sua senha · Build Agentflows",
    text: `${verify ? "Confirme seu e-mail" : "Escolha uma nova senha"}:\n\n${link}\n\nO link expira em ${verify ? "24 horas" : "30 minutos"} e só pode ser usado uma vez. Se não foi você, ignore esta mensagem.`,
  };
  await sql.query("INSERT INTO mail_outbox(id,payload_ciphertext) VALUES ($1,$2)", [id, seal(JSON.stringify(mail), `mail:${id}`)]);
}

/** One bounded batch; safe to run concurrently in workers, with a lease for crash recovery. */
export async function deliverAuthMail(db: Database, send: typeof fetch = fetch) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) throw new Error("Configure RESEND_API_KEY e RESEND_FROM.");
  const lease = randomUUID();
  const { rows } = await db.query<{ id: string; payload_ciphertext: string; attempts: number }>(`
    UPDATE mail_outbox SET lease_id=$1, lease_until=now()+interval '2 minutes', attempts=attempts+1
    WHERE id IN (SELECT id FROM mail_outbox
      WHERE sent_at IS NULL AND failed_at IS NULL AND attempts < 8 AND available_at <= now()
      AND (lease_until IS NULL OR lease_until < now())
      ORDER BY available_at LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING id,payload_ciphertext,attempts
  `, [lease]);
  for (const row of rows) {
    let ok = false;
    let permanent = false;
    try {
      const mail = JSON.parse(unseal(row.payload_ciphertext, `mail:${row.id}`)) as Mail;
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `auth/${row.id}` },
        body: JSON.stringify({ from: process.env.RESEND_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(10000),
      });
      ok = response.ok;
      permanent = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
      await response.body?.cancel();
    } catch { /* Retry without logging tokens, email contents or provider responses. */ }
    await db.query(`UPDATE mail_outbox SET
      sent_at=CASE WHEN $3 THEN now() ELSE NULL END,
      failed_at=CASE WHEN NOT $3 AND ($4 OR attempts >= 8) THEN now() ELSE NULL END,
      available_at=now()+$5*interval '1 second', lease_id=NULL, lease_until=NULL,
      payload_ciphertext=CASE WHEN $3 OR $4 OR attempts >= 8 THEN '' ELSE payload_ciphertext END
      WHERE id=$1 AND lease_id=$2`, [row.id, lease, ok, !ok && permanent, Math.min(3600, 30 * 2 ** row.attempts)]);
  }
  // A process could crash on its last leased attempt; retire it after the lease expires.
  await db.query(`UPDATE mail_outbox SET failed_at=now(),payload_ciphertext='',lease_id=NULL,lease_until=NULL
    WHERE sent_at IS NULL AND failed_at IS NULL AND attempts >= 8 AND lease_until < now()`);
  return rows.length;
}
