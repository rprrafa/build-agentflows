import test from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeHit } from "./knowledge-types";
import { chatReferences, knowledgeReferences, referenceChunks, referenceUrl } from "./knowledge-references";

const hit: KnowledgeHit = {
  id: "chunk-1", sourceId: "source-1", ordinal: 1, baseId: "base-1", baseName: "Cursos",
  sourceName: "Manual do curso", score: 0.9, pageContent: "Texto completo\n\n" + "Conteúdo do documento. ".repeat(400),
  metadata: { source: "https://example.com/manual", pageNumber: 3, internal: "not-for-display" },
};

test("referências preservam o chunk completo e copiam somente metadados de origem", () => {
  const [snapshot] = referenceChunks([hit]);
  assert.equal(snapshot.pageContent, hit.pageContent);
  assert.equal(snapshot.page, 3);
  assert.equal(snapshot.source, hit.metadata.source);
  assert.ok(!("metadata" in snapshot));
  assert.doesNotMatch(JSON.stringify(snapshot), /not-for-display/);
  const changed = structuredClone(hit);
  const stored = referenceChunks([changed]);
  changed.pageContent = "Documento reindexado";
  assert.equal(stored[0].pageContent, hit.pageContent);
});

test("chat mostra cada chunk do mesmo documento e deduplica consultas entre agentes sem apagar a resposta", () => {
  const second = { ...hit, id: "chunk-2", ordinal: 2, pageContent: "Segundo trecho." };
  const refs = referenceChunks([hit, second]);
  const prose = "**Referências encontradas** é o nome da seção.\n\nResposta do agente.";
  const text = prose + knowledgeReferences([hit, second]);
  const result = chatReferences(text, [{ chunks: refs }, { chunks: refs }]);
  assert.equal(result.text, prose);
  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[1].pageContent, second.pageContent);
  assert.equal(chatReferences(text, [{}]).text, text, "Histórico antigo sem snapshots mantém referências em texto");
  assert.deepEqual(chatReferences("Olá!", [{ chunks: [] }]), { text: "Olá!", chunks: [] });
  assert.equal(chatReferences("Resposta", [{ chunks: refs }, { chunks: [{ ...refs[0], baseId: "outra-base" }] }]).chunks.length, 3);
  const otherDocument = { ...second, sourceId: "source-2", sourceName: "Outro documento" };
  const expanded = chatReferences(prose + knowledgeReferences([hit, otherDocument]), [{ chunks: referenceChunks([hit]) }, { chunks: referenceChunks([hit, otherDocument]) }]);
  assert.equal(expanded.text, prose, "Agentes seguintes podem ampliar a lista sem deixar referências duplicadas no texto");
});

test("links de origem aceitam apenas HTTP(S) sem credenciais", () => {
  for (const source of [undefined, "javascript:alert(1)", "data:text/html,test", "file:///tmp/manual", "https://user:secret@example.com/"]) assert.equal(referenceUrl(source), undefined);
  assert.equal(referenceUrl("https://example.com/manual"), "https://example.com/manual");
});
