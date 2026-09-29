import test from "node:test";
import assert from "node:assert/strict";
import { isRunPage, parseRunPage } from "./run-page";

const item = {
  id: "run-1", flowId: "flow-1", name: "Execução", input: "Teste",
  status: "completed", demo: true, createdAt: "2026-09-25T00:00:00Z",
};
const page = { items: [item], page: 1, pageSize: 20, total: 1, totalPages: 1 };

test("aceita páginas completas, vazias e última página parcial", () => {
  assert.equal(parseRunPage(page), page);
  assert.ok(isRunPage({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }));
  assert.ok(isRunPage({ ...page, page: 2, total: 21, totalPages: 2 }));
});

test("recusa respostas legadas, ausentes ou malformadas antes de atualizar a tela", () => {
  for (const value of [undefined, null, [], [item], {}, { error: "Falha" },
    { ...page, items: undefined }, { ...page, items: null },
    { ...page, items: {} }, { ...page, items: [null] },
    { ...page, items: [{ ...item, name: {} }] },
    { ...page, items: [{ ...item, status: "invalid" }] },
    { ...page, page: undefined }, { ...page, page: 0 },
    { ...page, pageSize: 0 }, { ...page, pageSize: 101 },
    { ...page, total: -1 }, { ...page, totalPages: "1" },
    { ...page, totalPages: 2 }, { ...page, items: [] },
  ]) {
    assert.equal(isRunPage(value), false);
    assert.throws(() => parseRunPage(value), /resposta inválida do servidor/);
  }
  assert.equal(parseRunPage(page), page);
});
