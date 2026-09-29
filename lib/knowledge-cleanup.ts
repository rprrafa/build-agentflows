import { createHash } from "node:crypto";
import { FlowError } from "./flow-store";
import type { Chunk, IndexConfig } from "./knowledge-types";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contentIdentity = (chunk: Chunk) => digest([chunk.sourceId, chunk.pageContent, chunk.metadata]);

/** Carry retained content into the new generation before retiring the old one. */
export function retainedKnowledgeChunks(
  config: IndexConfig["recordManager"],
  incoming: Chunk[],
  previous: Chunk[],
): Chunk[] {
  const mode = config.provider === "none" ? "full" : config.cleanup ?? "full";
  if (mode === "full") return [];
  function source(chunk: Chunk) {
    const key = config.sourceIdKey;
    if (!key) return chunk.sourceId;
    const value = Object.hasOwn(chunk.metadata, key) ? chunk.metadata[key] : undefined;
    if (!((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))))
      throw new FlowError(`O trecho ${chunk.ordinal} precisa do metadado “${key}” para a limpeza incremental. Use um texto ou número como identificador da fonte, ou escolha a identificação automática.`);
    return JSON.stringify([typeof value, value]);
  }
  const updated = mode === "incremental" ? new Set(incoming.map(source)) : new Set<string>();
  const seen = new Set(incoming.map(contentIdentity));
  const ids = new Set(incoming.map(chunk => chunk.id));
  const retained: Chunk[] = [];
  for (const chunk of previous) {
    if (mode === "incremental" && updated.has(source(chunk))) continue;
    const identity = contentIdentity(chunk);
    if (seen.has(identity)) continue;
    seen.add(identity);
    // Manual edits keep the original chunk ID. Preserve both versions without a collision.
    const id = ids.has(chunk.id) ? digest(["retained", chunk.id, identity]) : chunk.id;
    ids.add(id);
    retained.push({ ...chunk, id });
  }
  return retained;
}
