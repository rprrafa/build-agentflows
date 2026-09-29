import { currentTenant } from "./tenant-context";
import { AuthError, hashToken, randomToken, seal, unseal } from "./saas-security";
import { consumeRateLimit } from "./saas-rate-limit";

/** State is bound to the account, provider/endpoint and browser PKCE verifier. */
export async function beginIntegrationOAuth(provider: string, verifier: string) {
  const { db, user } = currentTenant();
  await consumeRateLimit(db, `integration-oauth:${user.id}`, 10, 600);
  const state = randomToken(), digest = hashToken(state);
  await db.query(`INSERT INTO oauth_states(state_hash,binding_hash,payload_ciphertext,expires_at)
    VALUES ($1,$2,$3,now()+interval '10 minutes')`, [digest, hashToken(verifier), seal(JSON.stringify({ owner: user.id, provider }), `integration-oauth:${digest}`)]);
  return state;
}
export async function consumeIntegrationOAuth(provider: string, state: string | null, verifier: string) {
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) throw new AuthError("Autorização expirada. Conecte novamente.", 401);
  const { db, user } = currentTenant();
  const digest = hashToken(state);
  const { rows } = await db.query<{ payload_ciphertext: string }>("SELECT payload_ciphertext FROM oauth_states WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>now()", [digest, hashToken(verifier)]);
  if (!rows[0]) throw new AuthError("Autorização expirada. Conecte novamente.", 401);
  const payload = JSON.parse(unseal(rows[0].payload_ciphertext, `integration-oauth:${digest}`));
  if (payload.owner !== user.id || payload.provider !== provider) throw new AuthError("A autorização pertence a outra conexão ou conta.", 403);
  const claimed = await db.query("DELETE FROM oauth_states WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>now() RETURNING state_hash", [digest, hashToken(verifier)]);
  if (!claimed.rows.length) throw new AuthError("Esta autorização já foi utilizada.", 401);
}
