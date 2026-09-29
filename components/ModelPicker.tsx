"use client";
import { useEffect, useMemo, useState } from "react";
import { request } from "./StudioUI";
import { MEDIA_MODELS, MEDIA_PROVIDERS, mediaModel, isMediaModel, type MediaProvider } from "@/lib/media-models";
export type ChatModel = { id: string; name: string; inputModalities?: string[] };
export type RouterModel = { id: string; nome: string; provedor: string; inputModalities?: string[] };
const PREFIX = "openrouter:";
// Nome curto de um modelo salvo no bloco, para a pílula do bloco e a lista.
export const OPENROUTER_AUTO = PREFIX + "openrouter/auto";
export function modelLabel(model?: string) {
  if (!model) return "ChatGPT";
  if (mediaModel(model)) return mediaModel(model)!.name;
  if (model === OPENROUTER_AUTO) return "OpenRouter automático";
  if (model.startsWith(PREFIX)) {
    const id = model.slice(PREFIX.length);
    return id.includes("/") ? id.split("/").slice(1).join("/") : id;
  }
  return model;
}
export function modelProvider(model?: string) {
  const media = mediaModel(model);
  if (media) return MEDIA_PROVIDERS.find((provider) => provider.id === media.provider)!.name;
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
  const [mediaConnected, setMediaConnected] = useState<MediaProvider[]>([]);
  useEffect(() => {
    let alive = true;
    void request<{ providers: { id: MediaProvider; conectado: boolean }[] }>("/api/conexoes/media")
      .then((result) => { if (alive) setMediaConnected(result.providers.filter((provider) => provider.conectado).map((provider) => provider.id)); })
      .catch(() => {});
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
    !!mediaModel(value) ||
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
        {MEDIA_PROVIDERS.map((provider) => <optgroup key={provider.id} label={`${provider.name} · gerar imagens`}>
          {MEDIA_MODELS.filter((model) => model.provider === provider.id).map((model) => <option key={model.id} value={model.id}>
            {model.name}{model.inputModalities.includes("image") ? " · gerar e editar" : " · texto para imagem"}{mediaConnected.includes(provider.id) ? "" : " · configure a chave"}
          </option>)}
        </optgroup>)}
        {!known && <option value={value}>{value} · modelo salvo</option>}
      </select>
      {isMediaModel(value) && <small>Gera imagens a partir da descrição. As imagens ficam privadas no fluxo. Configure sua chave em Configurações; cada geração usa o saldo do provedor. Cancelar aqui pode não interromper a cobrança no provedor.{mediaModel(value)?.inputModalities.includes("image") ? " Referências: até 5 imagens e 6 MB no total." : " Este modelo recebe apenas texto."}</small>}
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
