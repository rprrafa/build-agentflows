import type { KnowledgeHit } from "./knowledge-types";

// Keep the exact retrieved text in the execution, even if the source is reindexed or removed.
// Only source attribution is copied from metadata; provider/internal metadata is not exposed.
export type KnowledgeReference = Omit<KnowledgeHit, "metadata"> & {
  source?: string;
  page?: string | number;
};
export function referenceChunks(hits: KnowledgeHit[]): KnowledgeReference[] {
  return hits.map(({ metadata, ...chunk }) => {
    const page = metadata.page ?? metadata.pageNumber;
    return {
      ...chunk,
      ...(typeof metadata.source === "string" ? { source: metadata.source } : {}),
      ...(typeof page === "string" || typeof page === "number" ? { page } : {}),
    };
  });
}
export function knowledgeReferences(hits: KnowledgeHit[]) {
  return referenceAppendix(referenceChunks(hits));
}
export function referenceUrl(source?: string) {
  try {
    const url = new URL(source || "");
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {}
  return undefined;
}

function escapeMarkdown(value: unknown) {
  return String(value)
    .replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}
export function referenceAppendix(hits: KnowledgeReference[]) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const hit of hits) {
    const origin =
      hit.source || "";
    const page = hit.page;
    const identity = JSON.stringify([hit.baseId, hit.sourceId, origin, page]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    let url = "";
    try {
      const parsed = new URL(origin);
      if (
        ["https:", "http:"].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password
      )
        url = parsed.href.replaceAll("(", "%28").replaceAll(")", "%29");
    } catch {}
    const title = escapeMarkdown(
      hit.sourceName + (page !== undefined ? ` · página ${page}` : ""),
    );
    lines.push(
      `- ${url ? `[${title}](${url})` : title}${!url && origin && origin !== "Texto adicionado" ? ` — ${escapeMarkdown(origin)}` : ""}`,
    );
  }
  return lines.length
    ? "\n\n**Referências encontradas**\n\n" + lines.join("\n")
    : "";
}

/** Used only by the test chat. Text-only channels retain the existing source appendix. */
export function chatReferences(text: string, groups: { chunks?: KnowledgeReference[] }[]) {
  const chunks: KnowledgeReference[] = [];
  const seen = new Set<string>();
  const appendices = new Set<string>();
  for (const group of groups) {
    if (!group.chunks?.length) continue;
    appendices.add(referenceAppendix(group.chunks));
    for (const chunk of group.chunks) {
      const key = JSON.stringify([chunk.baseId, chunk.id, chunk.pageContent]);
      if (seen.has(key)) continue;
      seen.add(key);
      chunks.push(chunk);
    }
  }
  // Longer lists first: one agent's sources may be a prefix of another agent's list.
  // Replace only known, system-generated appendices, never the model's prose.
  for (const appendix of [...appendices].sort((a, b) => b.length - a.length)) text = text.replaceAll(appendix, "");
  return { text, chunks };
}
