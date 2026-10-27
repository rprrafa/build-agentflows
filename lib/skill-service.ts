// Habilidades da conta: gravadas no PostgreSQL (tabela skills) e escolhidas por id no Agente (config.skills).
import { randomUUID } from "node:crypto";
import { currentTenant } from "./tenant-context";
import { assertJobLease } from "./saas-job-context";
import { FlowError } from "./flow-store";
import { parseSkillUpload, SkillPackageError, type SkillPackage } from "./skill-package";
import { estimateTokens, skillHeader, MAX_ACCOUNT_SKILLS, MAX_SKILL_UPLOAD_BYTES, type SkillSummary } from "./skill-settings";

export type StoredSkill = SkillPackage & { id: string; createdAt: string; updatedAt: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const missing = () => new FlowError("Habilidade não encontrada nesta conta.", 404);

export function summarizeSkill(skill: StoredSkill): SkillSummary {
  return {
    id: skill.id, name: skill.name, description: skill.description,
    files: skill.files.map((file) => file.path), skipped: skill.skipped,
    headerTokens: estimateTokens(skillHeader(skill)), bodyTokens: estimateTokens(skill.body),
    updatedAt: skill.updatedAt,
  };
}

export async function listSkills(): Promise<SkillSummary[]> {
  const { db, user } = currentTenant();
  const { rows } = await db.query<{ body: StoredSkill }>("SELECT body FROM skills WHERE user_id=$1 ORDER BY name", [user.id]);
  return rows.map((row) => summarizeSkill(row.body));
}

export async function getSkill(id: string): Promise<StoredSkill> {
  if (!UUID.test(id)) throw missing();
  const { db, user } = currentTenant();
  const { rows } = await db.query<{ body: StoredSkill }>("SELECT body FROM skills WHERE user_id=$1 AND id=$2", [user.id, id]);
  if (!rows[0]) throw missing();
  return rows[0].body;
}

/** Habilidades de um Agente, na ordem escolhida. Uma habilidade excluída impede a etapa antes de qualquer chamada ao modelo. */
export async function skillsByIds(ids: string[]): Promise<StoredSkill[]> {
  if (!ids.length) return [];
  const { db, user } = currentTenant();
  const { rows } = await db.query<{ body: StoredSkill }>("SELECT body FROM skills WHERE user_id=$1 AND id=ANY($2::text[])", [user.id, ids]);
  const found = new Map(rows.map((row) => [row.body.id, row.body]));
  if (found.size !== ids.length) throw new FlowError("Uma habilidade escolhida no agente foi excluída. Abra o bloco e remova-a ou envie-a de novo.", 409);
  return ids.map((id) => found.get(id)!);
}

/** Lê o envio (SKILL.md ou .zip). Uma habilidade com o mesmo name é atualizada e mantém o id, para os agentes que já a usam. */
export async function saveSkill(file: File): Promise<SkillSummary & { replaced: boolean }> {
  if (file.size > MAX_SKILL_UPLOAD_BYTES) throw new FlowError("O arquivo da habilidade pode ter até 5 MB.", 413);
  let parsed: SkillPackage;
  try { parsed = parseSkillUpload(file.name, new Uint8Array(await file.arrayBuffer())); }
  catch (error) { throw error instanceof SkillPackageError ? new FlowError(error.message) : error; }
  const { db, user } = currentTenant();
  return db.transaction(async (sql) => {
    await assertJobLease(sql, user.id);
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    const now = new Date().toISOString();
    const { rows } = await sql.query<{ body: StoredSkill }>("SELECT body FROM skills WHERE user_id=$1 AND name=$2", [user.id, parsed.name]);
    const previous = rows[0]?.body;
    if (!previous) {
      const { rows: count } = await sql.query<{ count: number }>("SELECT count(*)::int AS count FROM skills WHERE user_id=$1", [user.id]);
      if (count[0].count >= MAX_ACCOUNT_SKILLS) throw new FlowError(`Sua conta pode ter até ${MAX_ACCOUNT_SKILLS} habilidades. Exclua as que não usa mais.`, 413);
    }
    const skill: StoredSkill = { ...parsed, id: previous?.id || randomUUID(), createdAt: previous?.createdAt || now, updatedAt: now };
    await sql.query(
      "INSERT INTO skills(user_id,id,name,body,updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (user_id,id) DO UPDATE SET body=EXCLUDED.body,updated_at=now()",
      [user.id, skill.id, skill.name, JSON.stringify(skill)],
    );
    return { ...summarizeSkill(skill), replaced: !!previous };
  });
}

/** Exclui a habilidade só quando nenhum fluxo a usa, para não quebrar agentes salvos. */
export async function deleteSkill(id: string) {
  if (!UUID.test(id)) throw missing();
  const { db, user } = currentTenant();
  await db.transaction(async (sql) => {
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    const { rows } = await sql.query<{ name: string }>(
      `SELECT body->>'name' AS name FROM flows WHERE user_id=$1 AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(body->'graph'->'nodes') AS node
        WHERE $2 = ANY(string_to_array(replace(coalesce(node->'data'->'config'->>'skills',''),' ',''),','))
      ) ORDER BY sequence DESC LIMIT 5`,
      [user.id, id],
    );
    if (rows.length) throw new FlowError(`Esta habilidade está em uso em: ${rows.map((row) => `“${row.name}”`).join(", ")}. Remova-a dos agentes antes de excluir.`, 409);
    const { rows: deleted } = await sql.query("DELETE FROM skills WHERE user_id=$1 AND id=$2 RETURNING id", [user.id, id]);
    if (!deleted.length) throw missing();
  });
  return { ok: true };
}
