// Lista de modelos do OpenRouter usada tanto por lib/setup-comum.ts (Server) quanto por components/ui.tsx
// (Client, em ErrorBox: "Usar um modelo gratuito"). Sem nenhum import node:*, mesmo padrão de lib/conta-comum.ts.
export type Opcao = { valor: string; rotulo: string; /** Agrupamento do <select> em lib/setup-comum.ts/components/setup.tsx (só usado por MODELOS_GRATUITOS). */ grupo?: "recomendado" | "gratuito" | "pago" };

/** Um próximo passo sugerido (integração ainda não configurada): usado pelo popover "Faz mais com..." da
 * Topbar (components/ui.tsx) e pelo cartão "Tudo pronto" de /setup. Mora aqui (não em lib/setup-comum.ts,
 * o dono natural) porque o caminho desse módulo contém "/setup", que scripts/verificar-jargao.mjs trata
 * como jargão técnico ao ser importado por um componente varrido pelo script (ui.tsx não é isento, ao
 * contrário de setup.tsx). */
export type ProximoPasso = { id: string; titulo: string; beneficio: string; url: string };

/** Valor de "Automático" nos campos de modelo de /setup: deixa o app escolher (o modelo padrão de
 * lib/ai.ts; na tarefa de avaliação, o modelo da tarefa padrão). Precisa de um valor de verdade porque
 * app/api/setup/route.ts trata string vazia como "não mexa neste campo". */
export const MODELO_AUTOMATICO = "auto";

export const MODELOS_GRATUITOS: Opcao[] = [
  { valor: "nvidia/nemotron-3-super-120b-a12b:free", rotulo: "Nemotron 3 Super 120B (gratuito, padrão)", grupo: "recomendado" },
  { valor: "google/gemma-4-31b-it:free", rotulo: "Gemma 4 31B (gratuito)", grupo: "gratuito" },
  { valor: "nvidia/nemotron-3-ultra-550b-a55b:free", rotulo: "Nemotron 3 Ultra 550B (gratuito)", grupo: "gratuito" },
  { valor: "anthropic/claude-sonnet-4.5", rotulo: "Claude Sonnet 4.5 (pago, mais qualidade)", grupo: "pago" },
  { valor: "openai/gpt-5-mini", rotulo: "GPT-5 mini (pago)", grupo: "pago" },
];

/** Modelos com suporte a imagem no OpenRouter. Verificado em 2026-09-14 em openrouter.ai/models (filtro "image" em input modalities); primeiro gratuito. */
export const MODELOS_VISAO: Opcao[] = [
  { valor: "inclusionai/ling-3.0-flash-vl:free", rotulo: "Ling 3.0 Flash VL (gratuito, padrão)" },
  { valor: "nex-agi/nex-n2.5-pro:free", rotulo: "Nex N2.5 Pro (gratuito)" },
  { valor: "anthropic/claude-sonnet-4.5", rotulo: "Claude Sonnet 4.5 (pago, mais qualidade)" },
];
