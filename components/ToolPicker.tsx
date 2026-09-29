"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolGroup } from "@/lib/tools";
import { belongsToCard, readToolCards, replaceToolCard, selectedTools, type ToolCard as Card } from "@/lib/agent-tools";
import { Icon, request } from "./StudioUI";
import { ToolSelect } from "./ToolSelect";
import { ToolParameters, ACTION_TOOLS } from "./ToolParameters";
import { McpToolCard } from "./McpToolCard";
import type { ToolServer } from "./ToolServers";
import type { SavedToolCredential } from "@/lib/tool-credential-store";
import { toolTitle } from "@/lib/tool-presentation";
export function ToolPicker({ value, cardsValue = "", onChange }: {
  value: string; cardsValue?: string; onChange: (value: string, cards: string) => void;
}) {
  const [groups, setGroups] = useState<ToolGroup[] | null>(null), [servers, setServers] = useState<ToolServer[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [credentials, setCredentials] = useState<SavedToolCredential[]>([]);
  const root = useRef<HTMLDivElement>(null), generation = useRef(0);
  const selected = selectedTools(value), cards = readToolCards(value, cardsValue);
  const latest = useRef({ selected, cards });
  useEffect(() => { latest.current = { selected: selectedTools(value), cards: readToolCards(value, cardsValue) }; }, [value, cardsValue]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true);
    const [tools, connections, accounts] = await Promise.allSettled([
      request<ToolGroup[]>("/api/tools?server=interno"), request<ToolServer[]>("/api/conexoes/mcp"),
      request<SavedToolCredential[]>("/api/tool-credentials"),
    ]);
    if (current !== generation.current) return;
    if (tools.status === "fulfilled") setGroups(tools.value);
    if (connections.status === "fulfilled") setServers(connections.value);
    if (accounts.status === "fulfilled") setCredentials(accounts.value);
    setError(tools.status === "rejected" || connections.status === "rejected" || accounts.status === "rejected" ? "Não foi possível atualizar todas as conexões. Suas seleções foram preservadas. Tente novamente." : "");
    setBusy(false);
  }, []);
  useEffect(() => {
    const invalidate = () => { generation.current++; };
    const timer = setTimeout(() => void refresh(), 0);
    const focus = () => void refresh(); window.addEventListener("focus", focus);
    return () => { clearTimeout(timer); invalidate(); window.removeEventListener("focus", focus); };
  }, [refresh]);
  function commit(ids: string[], next: Card[]) {
    latest.current = { selected: [...new Set(ids)], cards: next };
    onChange(latest.current.selected.join(","), JSON.stringify(next));
  }
  function replace(id: string, target: string | null) {
    if (latest.current.cards.find((card) => card.id === id)?.target === target) return;
    const next = replaceToolCard(latest.current.selected, latest.current.cards, id, target);
    commit(next.selected, next.cards.map((card) => card.id === id && target ? { ...card, params: ACTION_TOOLS.includes(target.split(":")[1]) ? { actions: "[]" } : target === "interno:executar_fluxo" ? { flowId: "" } : {} } : card));
  }
  function add(kind: Card["kind"], target = "") {
    if (target && latest.current.cards.some((card) => card.kind === kind && card.target === target)) return;
    const id = crypto.randomUUID();
    commit(kind === "tool" && target ? [...latest.current.selected, target] : latest.current.selected, [...latest.current.cards, { id, kind, target }]);
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`[data-tool-card="${id}"] input[role="combobox"]`)?.focus());
  }
  const tools = (groups || []).flatMap((g) => g.tools);
  return <div className="tool-picker" ref={root}>
    {error && <div role="alert"><p className="studio-error">{error}</p><button type="button" className="studio-button" disabled={busy} onClick={() => void refresh()}>Tentar novamente</button></div>}
    {busy && !groups && <p role="status">Carregando ferramentas e conexões…</p>}
    <div className="agent-tool-cards">{cards.map((card, index) => {
      if (card.kind === "mcp") return <div key={card.id} data-tool-card={card.id}><McpToolCard
        target={card.target} servers={servers} used={cards.filter((c) => c.kind === "mcp").map((c) => c.target)} selected={selected}
        onTarget={(target) => replace(card.id, target)} onRemove={() => replace(card.id, null)}
        onSelection={(ids) => commit([...latest.current.selected.filter((id) => !belongsToCard(id, card)), ...ids], latest.current.cards)}
        onServerSaved={(s) => setServers((all) => [...all.filter((o) => o.prefixo !== s.prefixo), s])}
        onServerDeleted={(target) => setServers((all) => all.filter((o) => o.prefixo !== target))}
      /></div>;
      const tool = tools.find((t) => t.id === card.target);
      const title = tool ? toolTitle(tool) : (card.target ? card.target.split(":").pop()! : "Nova ferramenta");
      return <div className="agent-tool-block" key={card.id} data-tool-card={card.id}>
        <div className="agent-tool-heading"><label>Ferramenta</label><span>{index + 1}</span><button type="button" className="studio-icon-button" aria-label={`Remover ${title}`} onClick={() => replace(card.id, null)}><Icon name="trash" size={17} /></button></div>
        <ToolSelect value={card.target} used={cards.filter((c) => c.id !== card.id).map((c) => c.target)} onChange={(target) => replace(card.id, target)} />
        {tool && (tool.credentialProvider || ["executar_fluxo", "data_hora"].includes(tool.name)) && <details className="tool-parameters" key={tool.id}><summary><Icon name="settings" size={18} /><span>Parâmetros</span><Icon name="chevron" size={16} /></summary>
          <ToolParameters tool={tool} card={card} credentials={credentials}
            onChange={(patch) => commit(latest.current.selected, latest.current.cards.map((c) => c.id === card.id ? { ...c, ...patch } : c))}
            onSaved={(credential) => setCredentials((all) => [...all.filter((c) => c.id !== credential.id), credential])} />
        </details>}
        {card.target && !tool && groups && <p className="studio-error">Ferramenta indisponível. Selecione outra.</p>}
      </div>;
    })}</div>
    <button type="button" className="studio-button tool-add-button" disabled={!groups} onClick={() => add("tool")}><Icon name="plus" size={16} />Adicionar ferramenta</button>
  </div>;
}
