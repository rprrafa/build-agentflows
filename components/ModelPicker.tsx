"use client";
import { useEffect, useMemo, useState } from "react";
import { request } from "./StudioUI";
export type ChatModel = { id: string; name: string; inputModalities?: string[] };
export type RouterModel = { id: string; nome: string; provedor: string; inputModalities?: string[] };
const PREFIX = "openrouter:";
// Nome curto de um modelo salvo no bloco, para a pílula do bloco e a lista.
export const OPENROUTER_AUTO = PREFIX + "openrouter/auto";
export function modelLabel(model?: string) {
  if (!model) return "ChatGPT";
  if (model === OPENROUTER_AUTO) return "OpenRouter automático";
  if (model.startsWith(PREFIX)) {
    const id = model.slice(PREFIX.length);
    return id.includes("/") ? id.split("/").slice(1).join("/") : id;
  }
  return model;
}
export function modelProvider(model?: string) {
  return model?.startsWith(PREFIX) ? "OpenRouter" : "ChatGPT";
}
// Seletor de modelo: ChatGPT (assinatura, principal) e, quando conectado, os modelos do
// OpenRouter agrupados por provedor.
export function ModelPicker({
  value,
  chatModels,
  connected,
  onChange,
}: {
  value: string;
  chatModels: ChatModel[];
  connected: boolean;
  onChange: (v: string) => void;
}) {
  const [router, setRouter] = useState<RouterModel[] | null>(null);
  const [routerConnected, setRouterConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    void request<{ conectado: boolean; modelos: RouterModel[] }>(
      "/api/conexoes/modelos",
    )
      .then((r) => { if (alive) { setRouterConnected(r.conectado); setRouter(r.conectado ? r.modelos : []); } })
      .catch(() => alive && setRouter([]));
    return () => {
      alive = false;
    };
  }, []);
  const groups = useMemo(() => {
    const map = new Map<string, RouterModel[]>();
    for (const m of router || []) map.set(m.provedor, [...(map.get(m.provedor) || []), m]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [router]);
  const known =
    !value ||
    value === OPENROUTER_AUTO ||
    chatModels.some((m) => m.id === value) ||
    (router || []).some((m) => PREFIX + m.id === value);
  return (
    <div className="model-picker">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="ChatGPT · assinatura (principal)">
          <option value="">Padrão da conexão ChatGPT</option>
          {chatModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.inputModalities?.includes("image") ? " · imagens" : ""}
            </option>
          ))}
        </optgroup>
        {router && router.length > 0 && (
          <optgroup label="OpenRouter · automático">
            <option value={OPENROUTER_AUTO}>
              Automático · OpenRouter escolhe o melhor modelo
            </option>
          </optgroup>
        )}
        {groups.map(([provider, models]) => (
          <optgroup key={provider} label={"OpenRouter · " + provider}>
            {models.map((m) => (
              <option key={m.id} value={PREFIX + m.id}>
                {m.nome}{m.inputModalities?.includes("image") ? " · imagens" : ""}
              </option>
            ))}
          </optgroup>
        ))}
        {!known && <option value={value}>{value} · modelo salvo</option>}
      </select>
      {(router === null || router.length > 0 || (!connected && !routerConnected)) && <small>
        {router === null
          ? "Consultando conexões…"
          : router.length
            ? `${router.length} modelos do OpenRouter disponíveis além do ChatGPT.`
            : "Conecte o OpenRouter em Configurações para escolher entre mais de 500 modelos."}
      </small>}
    </div>
  );
}
