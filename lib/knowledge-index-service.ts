export * from "./tenant-knowledge-index";
export async function cleanupPending(baseId: string) {
  const { currentTenant } = await import("./tenant-context");
  const { getKnowledgeBase } = await import("./tenant-knowledge");
  await getKnowledgeBase(baseId);
  const { db, user } = currentTenant();
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int n FROM knowledge_cleanup c WHERE c.user_id=$1 AND c.base_id=$2 AND NOT EXISTS(SELECT 1 FROM knowledge_indexes i WHERE i.user_id=c.user_id AND i.base_id=c.base_id AND i.generation=c.id)", [user.id, baseId]);
  return rows[0].n;
}
