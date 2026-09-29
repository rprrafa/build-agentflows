import { currentTenant } from "./tenant-context";
import { stageConfig } from "./tenant-config-state";

/** Async configuration, scoped at each call; no environment or previous-user fallback. */
export async function tenantConfig(key: string) {
  return currentTenant().config.values.get(key);
}
export async function setTenantConfig(key: string, value: string | null | undefined) {
  stageConfig(currentTenant().config, key, value);
}
export async function allTenantConfig() {
  return Object.fromEntries(currentTenant().config.values);
}
