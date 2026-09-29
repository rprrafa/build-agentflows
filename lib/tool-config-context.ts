import { AsyncLocalStorage } from "node:async_hooks";
import { getConfig, setConfig } from "./store";
import { tenantId } from "./tenant-context";

type Scope = { keys: Set<string>; values: Record<string, string>; save: (key: string, value: string | null | undefined) => void };
const scopes = new AsyncLocalStorage<Scope>();
export function withToolConfig<T>(scope: Scope, action: () => T): T { return scopes.run(scope, action); }
export function toolConfig(key: string): string | undefined {
  tenantId(); // A captured tool scope may not outlive its authenticated operation.
  const scope = scopes.getStore();
  // Uma conta selecionada nunca herda campos ausentes de outra conta ou do ambiente.
  return scope?.keys.has(key) ? scope.values[key] : getConfig(key);
}
export function setToolConfig(key: string, value: string | null | undefined) {
  tenantId();
  const scope = scopes.getStore();
  if (!scope?.keys.has(key)) return setConfig(key, value);
  scope.save(key, value);
  if (value) scope.values[key] = value; else delete scope.values[key];
}
