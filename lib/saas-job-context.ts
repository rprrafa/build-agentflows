import { AsyncLocalStorage } from "node:async_hooks";
import type { Sql } from "./saas-db";
import { AuthError } from "./saas-security";

type Lease = { id: string; owner: string; token: string; signal?: AbortSignal };
const leases = new AsyncLocalStorage<Lease>();
export const currentJobLease = () => leases.getStore();
export function jobSignal(timeout: number) {
  const signal = leases.getStore()?.signal;
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
}
export function withJobLease<T>(lease: Lease, action: () => Promise<T>) { return leases.run(lease, action); }
export async function assertJobLease(sql: Sql, owner: string) {
  const lease = leases.getStore();
  if (!lease) return;
  if (lease.owner !== owner) throw new AuthError("A execução pertence a outra conta.", 403);
  const { rows } = await sql.query(`SELECT j.id FROM jobs j JOIN users u ON u.id=j.user_id
    WHERE j.id=$1 AND j.user_id=$2 AND j.lease_token=$3 AND j.status='running' AND j.lease_until>now()
    AND u.beta_status='approved' AND u.email_verified_at IS NOT NULL FOR UPDATE OF j`, [lease.id, owner, lease.token]);
  if (!rows.length) throw new AuthError("A autorização desta execução expirou ou foi revogada.", 409);
}
