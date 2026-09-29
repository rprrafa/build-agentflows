// Configuration lives in the authenticated user's encrypted PostgreSQL credentials.
import { currentTenant } from "./tenant-context";
import { stageConfig } from "./tenant-config-state";
export function getConfig(key: string): string | undefined { return currentTenant().config.values.get(key); }
export function setConfig(key: string, value: string | null | undefined): void { stageConfig(currentTenant().config, key, value); }
/** Mostra só o começo e o fim de um segredo. */
export function mascarar(valor: string | undefined): string | null {
  if (!valor) return null;
  if (valor.length <= 8) return "••••";
  return `${valor.slice(0, 4)}••••${valor.slice(-4)}`;
}

/** Synchronous savepoint; the tenant boundary awaits the durable, encrypted commit. */
export function configTransaction<T>(action: () => T): T {
  const state = currentTenant().config;
  const values = new Map(state.values), dirty = new Set(state.dirty), guards = [...state.guards];
  try { return action(); }
  catch (error) { state.values = values; state.dirty = dirty; state.guards = guards; throw error; }
}
