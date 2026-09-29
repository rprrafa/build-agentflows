// Mapa segmento → ilustração de pessoa em public/ilustracoes (preparadas por
// ~/Desktop/projetos/assets/preparar.py). Estratégia, Gestão e Jurídico ainda não têm ilustração
// própria (as fontes originais tinham cartões de texto encostando na pessoa e a separação
// automática comia pedaços de roupa e notebook — ver tasks/prd-revisao-onboarding-erros-conta.md,
// US-004): esses segmentos ficam só com o `.blob-acento`, sem pessoa, até uma reexportação limpa.
export type Segmento =
  | "RH"
  | "Marketing"
  | "Vendas"
  | "Financeiro"
  | "Atendimento"
  | "Estratégia"
  | "Gestão"
  | "Jurídico";

export type VarianteIlustracao = { largura: number; altura: number };

export type Ilustracao = {
  nome: string;
  // da menor para a maior; a menor é o 1x usado como base de layout (width/height do <img>).
  variantes: VarianteIlustracao[];
};

const ILUSTRACOES: Partial<Record<Segmento, Ilustracao>> = {
  RH: {
    nome: "pessoa-rh",
    variantes: [
      { largura: 640, altura: 746 },
      { largura: 1052, altura: 1226 },
    ],
  },
  Marketing: {
    nome: "pessoa-marketing",
    variantes: [
      { largura: 640, altura: 628 },
      { largura: 1240, altura: 1217 },
    ],
  },
  Vendas: {
    nome: "pessoa-vendas",
    variantes: [
      { largura: 640, altura: 595 },
      { largura: 1280, altura: 1190 },
    ],
  },
  Financeiro: {
    nome: "pessoa-financeiro",
    variantes: [
      { largura: 640, altura: 652 },
      { largura: 1186, altura: 1208 },
    ],
  },
  Atendimento: {
    nome: "chatbot",
    variantes: [
      { largura: 640, altura: 565 },
      { largura: 1058, altura: 934 },
    ],
  },
};

export function ilustracaoDoSegmento(segmento: Segmento): Ilustracao | undefined {
  return ILUSTRACOES[segmento];
}
