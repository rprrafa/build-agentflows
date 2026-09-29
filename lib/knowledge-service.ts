import { tenantId } from "./tenant-context";
import * as legacy from "./knowledge-store";
import * as tenant from "./tenant-knowledge";
export async function getKnowledgeBase(...args: Parameters<typeof legacy.getKnowledgeBase>) { return tenantId() ? tenant.getKnowledgeBase(...args) : legacy.getKnowledgeBase(...args); }
export async function listKnowledgeBases(...args: Parameters<typeof legacy.listKnowledgeBases>) { return tenantId() ? tenant.listKnowledgeBases(...args) : legacy.listKnowledgeBases(...args); }
export async function createKnowledgeBase(...args: Parameters<typeof legacy.createKnowledgeBase>) { return tenantId() ? tenant.createKnowledgeBase(...args) : legacy.createKnowledgeBase(...args); }
export async function updateKnowledgeBase(...args: Parameters<typeof legacy.updateKnowledgeBase>) { return tenantId() ? tenant.updateKnowledgeBase(...args) : legacy.updateKnowledgeBase(...args); }
export async function indexKnowledgeConfig(...args: Parameters<typeof legacy.indexKnowledgeConfig>) { return tenantId() ? tenant.indexKnowledgeConfig(...args) : legacy.indexKnowledgeConfig(...args); }
export async function listKnowledgeSources(...args: Parameters<typeof legacy.listKnowledgeSources>) { return tenantId() ? tenant.listKnowledgeSources(...args) : legacy.listKnowledgeSources(...args); }
export async function getKnowledgeSource(...args: Parameters<typeof legacy.getKnowledgeSource>) { return tenantId() ? tenant.getKnowledgeSource(...args) : legacy.getKnowledgeSource(...args); }
export async function getKnowledgeSourcePrivate(...args: Parameters<typeof legacy.getKnowledgeSourcePrivate>) { return tenantId() ? tenant.getKnowledgeSourcePrivate(...args) : legacy.getKnowledgeSourcePrivate(...args); }
export async function saveKnowledgeSource(...args: Parameters<typeof legacy.saveKnowledgeSource>) { return tenantId() ? tenant.saveKnowledgeSource(...args) : legacy.saveKnowledgeSource(...args); }
export async function saveKnowledgeSourceRecord(...args: Parameters<typeof legacy.saveKnowledgeSourceRecord>) { return tenantId() ? tenant.saveKnowledgeSourceRecord(...args) : legacy.saveKnowledgeSourceRecord(...args); }
export async function listKnowledgeChunks(...args: Parameters<typeof legacy.listKnowledgeChunks>) { return tenantId() ? tenant.listKnowledgeChunks(...args) : legacy.listKnowledgeChunks(...args); }
export async function replaceKnowledgeChunks(...args: Parameters<typeof legacy.replaceKnowledgeChunks>) { return tenantId() ? tenant.replaceKnowledgeChunks(...args) : legacy.replaceKnowledgeChunks(...args); }
export async function editKnowledgeChunk(...args: Parameters<typeof legacy.editKnowledgeChunk>) { return tenantId() ? tenant.editKnowledgeChunk(...args) : legacy.editKnowledgeChunk(...args); }
export async function knowledgeBaseUsages(...args: Parameters<typeof legacy.knowledgeBaseUsages>) { return tenantId() ? tenant.knowledgeBaseUsages(...args) : legacy.knowledgeBaseUsages(...args); }
export async function deleteKnowledgeSource(...args: Parameters<typeof legacy.deleteKnowledgeSource>) { return tenantId() ? tenant.deleteKnowledgeSource(...args) : legacy.deleteKnowledgeSource(...args); }
export async function deleteKnowledgeBaseRecords(...args: Parameters<typeof legacy.deleteKnowledgeBaseRecords>) { return tenantId() ? tenant.deleteKnowledgeBaseRecords(...args) : legacy.deleteKnowledgeBaseRecords(...args); }
export async function saveKnowledgeBaseRecord(...args: Parameters<typeof legacy.saveKnowledgeBaseRecord>) { return tenantId() ? tenant.saveKnowledgeBaseRecord(...args) : legacy.saveKnowledgeBaseRecord(...args); }
export async function saveKnowledgeRun(...args: Parameters<typeof legacy.saveKnowledgeRun>) { return tenantId() ? tenant.saveKnowledgeRun(...args) : legacy.saveKnowledgeRun(...args); }
export async function listKnowledgeRuns(...args: Parameters<typeof legacy.listKnowledgeRuns>) { return tenantId() ? tenant.listKnowledgeRuns(...args) : legacy.listKnowledgeRuns(...args); }
export async function withKnowledgeLock<T>(id: string, action: (token: string) => Promise<T>) { return tenantId() ? tenant.withKnowledgeLock(id, action) : legacy.withKnowledgeLock(id, action); }
