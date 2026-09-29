import { tenantId } from "./tenant-context";
import * as legacy from "./knowledge-index";
import * as tenant from "./tenant-knowledge-index";
export async function processKnowledgeSource(...args: Parameters<typeof legacy.processKnowledgeSource>) { return tenantId() ? tenant.processKnowledgeSource(...args) : legacy.processKnowledgeSource(...args); }
export async function cleanupKnowledge(...args: Parameters<typeof legacy.cleanupKnowledge>) { return tenantId() ? tenant.cleanupKnowledge(...args) : legacy.cleanupKnowledge(...args); }
export async function indexKnowledge(...args: Parameters<typeof legacy.indexKnowledge>) { return tenantId() ? tenant.indexKnowledge(...args) : legacy.indexKnowledge(...args); }
export async function queryKnowledge(...args: Parameters<typeof legacy.queryKnowledge>) { return tenantId() ? tenant.queryKnowledge(...args) : legacy.queryKnowledge(...args); }
export async function deleteKnowledgeBase(...args: Parameters<typeof legacy.deleteKnowledgeBase>) { return tenantId() ? tenant.deleteKnowledgeBase(...args) : legacy.deleteKnowledgeBase(...args); }
export async function removeKnowledgeSource(...args: Parameters<typeof legacy.removeKnowledgeSource>) { return tenantId() ? tenant.removeKnowledgeSource(...args) : legacy.removeKnowledgeSource(...args); }
export async function knowledgeStorageLocation(...args: Parameters<typeof legacy.knowledgeStorageLocation>) { return tenantId() ? tenant.knowledgeStorageLocation(...args) : legacy.knowledgeStorageLocation(...args); }
export async function cleanupPending(baseId: string) {
  if (!tenantId()) return Number(legacyPending(baseId));
  const { currentTenant } = await import("./tenant-context");
  const { getKnowledgeBase } = await import("./tenant-knowledge");
  await getKnowledgeBase(baseId);
  const { db, user } = currentTenant();
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int n FROM knowledge_cleanup c WHERE c.user_id=$1 AND c.base_id=$2 AND NOT EXISTS(SELECT 1 FROM knowledge_indexes i WHERE i.user_id=c.user_id AND i.base_id=c.base_id AND i.generation=c.id)", [user.id, baseId]);
  return rows[0].n;
}
import { knowledgeDb } from "./knowledge-store";
function legacyPending(baseId: string) {
  return knowledgeDb().prepare("SELECT count(*) n FROM knowledge_cleanup WHERE base_id=? AND id NOT IN (SELECT generation FROM knowledge_indexes WHERE base_id=?)").get(baseId, baseId)?.n || 0;
}
