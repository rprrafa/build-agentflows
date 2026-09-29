import test from "node:test";
import assert from "node:assert/strict";
import { selectedTools, readToolCards, replaceToolCard, type ToolCard } from "./agent-tools";

test("fluxos antigos ganham cartões por ferramenta e servidor sem ampliar permissões", () => {
  const value = "interno:calculadora,buscar,buscar,mcp:CRM:buscar,mcp:CRM:criar";
  assert.deepEqual(selectedTools(value), ["interno:calculadora", "mcp:FERRAMENTAS:buscar", "mcp:CRM:buscar", "mcp:CRM:criar"]);
  assert.deepEqual(readToolCards(value).map(({ kind, target }) => ({ kind, target })), [
    { kind: "tool", target: "interno:calculadora" }, { kind: "mcp", target: "FERRAMENTAS" }, { kind: "mcp", target: "CRM" },
  ]);
  assert.deepEqual(readToolCards(value, "inválido"), readToolCards(value));
});
test("cartões vazios e servidores sem ações sobrevivem ao salvamento, sem autorizar ações", () => {
  const cards: ToolCard[] = [{ id: "1", kind: "tool", target: "" }, { id: "2", kind: "mcp", target: "CRM" }];
  assert.deepEqual(readToolCards("", JSON.stringify(cards)), cards);
  assert.deepEqual(selectedTools(""), []);
  assert.deepEqual(readToolCards("", JSON.stringify([...cards, { ...cards[1], id: "3" }, { id: 5 }, null])), cards);
});
test("trocar ou remover um servidor retira só suas ações e preserva os demais cartões", () => {
  const selected = selectedTools("interno:tavily,mcp:CRM:buscar,mcp:CRM:criar,mcp:RH:buscar");
  const cards = readToolCards(selected.join(","));
  const crm = cards.find((c) => c.target === "CRM")!;
  const next = replaceToolCard(selected, cards, crm.id, "FINANCEIRO");
  assert.deepEqual(next.selected, ["interno:tavily", "mcp:RH:buscar"]);
  assert.equal(next.cards.find((c) => c.id === crm.id)?.target, "FINANCEIRO");
  const removed = replaceToolCard(selected, cards, crm.id, null);
  assert.deepEqual(removed.selected, next.selected);
  assert.ok(!removed.cards.some((c) => c.id === crm.id));
  assert.deepEqual(replaceToolCard(selected, cards, crm.id, "RH"), { selected, cards });
  assert.deepEqual(replaceToolCard(selected, cards, crm.id, "CRM"), { selected, cards });
});
test("trocar ferramenta preserva as permissões dos outros serviços e a ordem dos cartões", () => {
  const selected = selectedTools("interno:tavily,interno:calculadora,mcp:CRM:buscar");
  const cards = readToolCards(selected.join(","));
  const next = replaceToolCard(selected, cards, cards[0].id, "interno:google");
  assert.deepEqual(next.selected, ["interno:calculadora", "mcp:CRM:buscar", "interno:google"]);
  assert.equal(next.cards[0].target, "interno:google");
  const empty = replaceToolCard(next.selected, next.cards, cards[0].id, "");
  assert.deepEqual(empty.selected, ["interno:calculadora", "mcp:CRM:buscar"]);
  assert.equal(empty.cards[0].target, "");
});
