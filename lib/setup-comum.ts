// Tipos e utilitários do setup inicial. Compartilhado por toda a suíte: copie sem alterar.
// A lista de integrações de cada app fica em lib/integracoes.ts.
import { getConfig, mascarar, origemConfig, setConfig } from "./store";
import { enviar, type Canal } from "./notificacoes";
import { conectar, listarFerramentas, type FerramentaMCP } from "./mcp-cliente";
import { conexaoAutorizada } from "./mcp-oauth";
import { MODELO_AUTOMATICO, MODELOS_GRATUITOS, MODELOS_VISAO, type Opcao, type ProximoPasso } from "./modelos";
import { DEFAULT_MODEL, interpretarFalha, modelName } from "./ai";
import { contaConectada, credenciaisDoApp as credenciaisAppEmail } from "./email-envio";
import { tenantId, saasEnabled } from "./tenant-context";
import { appOrigin } from "./saas-security";

export type { Opcao, ProximoPasso };
export { MODELO_AUTOMATICO, MODELOS_GRATUITOS, MODELOS_VISAO };

export type Campo = {
  chave: string;
  rotulo: string;
  tipo: "secret" | "text" | "select";
  ajuda?: string;
  placeholder?: string;
  opcional?: boolean;
  /** Campo secundário: fica dentro de "Opções avançadas" no cartão, em vez do grupo principal. */
  avancado?: boolean;
  /** Mostra o campo só quando outro campo do mesmo cartão (`campo`) já tiver um dos `valores` indicados
   * (salvo ou ainda não salvo). Ex.: mostrar o webhook do Slack só quando o canal escolhido for "slack". */
  visivelQuando?: { campo: string; valores: string[] };
  padrao?: string;
  opcoes?: Opcao[];
  /** Opções carregadas da própria integração (ex.: quadros do Trello) quando as chaves anteriores já existem. */
  opcoesDinamicas?: (config: Record<string, string | undefined>) => Promise<Opcao[]>;
};

export type Integracao = {
  id: string;
  titulo: string;
  descricao: string;
  /** Descrição curta (uma linha, em linguagem de negócio) usada no lugar de `descricao` no cartão do
   * cabeçalho, ex.: "Liga a IA que gera o plano". Opcional: quando ausente, o cartão usa `descricao`. */
  beneficio?: string;
  obrigatoria: boolean;
  /** Onde a pessoa obtém a chave. */
  link?: { url: string; rotulo: string };
  /** Fluxo de conexão em um clique. "openrouter" é genérico; outros são tratados pelo app. */
  oauth?: { tipo: string; rotulo: string; url: string };
  /** Nota curta em linguagem de negócio mostrada antes de conectar (o que a integração exige, o que a
   * equipe técnica ainda precisa fazer). Some quando a integração já está conectada. */
  notaConexao?: string;
  campos: Campo[];
  /** Valida as chaves salvas chamando a integração. */
  testar?: (config: Record<string, string | undefined>) => Promise<{ ok: boolean; mensagem: string }>;
  /** Campo cujo valor define sozinho se a integração conta como conectada (chip "conectado", botão Autorizar/Conectado). Uma lista significa "qualquer um destes" (ex.: duas chaves alternativas no mesmo cartão). Por padrão, usa todos os campos não opcionais. */
  campoConectado?: string | string[];
};

export type CampoStatus = Omit<Campo, "opcoesDinamicas"> & { definido: boolean; origem: "env" | "banco" | null; mascarado: string | null; valorVisivel?: string };
/** `testavel`: a integração tem verificação automática (`testar`); sem ela, /setup não mostra "Testar conexão"
 * (um botão que só diria "não tem teste automático" não ajuda ninguém). */
export type IntegracaoStatus = Omit<Integracao, "campos" | "testar"> & { campos: CampoStatus[]; configurada: boolean; testavel: boolean };

/** Chaves necessárias para a integração contar como configurada. */
export function integracaoConfigurada(i: Integracao): boolean {
  if (i.campoConectado) {
    const chaves = Array.isArray(i.campoConectado) ? i.campoConectado : [i.campoConectado];
    return chaves.some((chave) => Boolean(getConfig(chave)));
  }
  return i.campos.filter((c) => !c.opcional).every((c) => Boolean(getConfig(c.chave)));
}

/** Integrações ainda não configuradas, obrigatória primeiro, em linguagem de negócio para "o que mais dá
 * para conectar" (popover da Topbar, cartão "Tudo pronto" de /setup). */
export function calcularProximos(lista: Integracao[]): ProximoPasso[] {
  return lista
    .filter((i) => !integracaoConfigurada(i))
    .sort((a, b) => Number(b.obrigatoria) - Number(a.obrigatoria))
    .map((i) => ({ id: i.id, titulo: i.titulo, beneficio: i.beneficio ?? i.descricao, url: `/setup#${i.id}` }));
}

export function lerConfig(i: Integracao): Record<string, string | undefined> {
  return Object.fromEntries(i.campos.map((c) => [c.chave, getConfig(c.chave) ?? c.padrao]));
}

export type StatusEnderecoPublico = { valor: string | null; origem: "env" | "banco" | null };

/** Valor de `APP_URL` para o campo "Endereço público do app" em /setup ("Para a equipe técnica"). */
export function statusEnderecoPublico(): StatusEnderecoPublico {
  if (tenantId()) return { valor: appOrigin(), origem: "env" };
  const valor = getConfig("APP_URL") ?? null;
  return { valor, origem: valor ? origemConfig("APP_URL") : null };
}

export type StatusCaixaEmail = { disponivel: boolean; conta?: string };
export type StatusCaixasEmail = { gmail: StatusCaixaEmail; outlook: StatusCaixaEmail };

/** Disponibilidade (credenciais do app definidas pela equipe técnica) e conta conectada de cada caixa
 * própria de e-mail (US-024), para o cartão "Notificações" mostrar os botões "Conectar meu Gmail"/
 * "Conectar meu Outlook" só quando fizer sentido. */
export function statusCaixasEmail(): StatusCaixasEmail {
  return {
    gmail: { disponivel: Boolean(credenciaisAppEmail("gmail")), conta: contaConectada("gmail") },
    outlook: { disponivel: Boolean(credenciaisAppEmail("outlook")), conta: contaConectada("outlook") },
  };
}

export async function statusIntegracoes(lista: Integracao[]): Promise<{ integracoes: IntegracaoStatus[]; pronto: boolean; enderecoPublico: StatusEnderecoPublico; caixasEmail: StatusCaixasEmail }> {
  const integracoes: IntegracaoStatus[] = [];
  for (const i of lista) {
    const config = lerConfig(i);
    const campos: CampoStatus[] = [];
    for (const c of i.campos) {
      const valor = getConfig(c.chave);
      let opcoes = c.opcoes;
      if (c.opcoesDinamicas) {
        try { opcoes = await c.opcoesDinamicas(config); } catch { opcoes = c.opcoes ?? []; }
      }
      const { opcoesDinamicas: _ignorado, ...resto } = c;
      void _ignorado;
      campos.push({
        ...resto,
        opcoes,
        definido: Boolean(valor),
        origem: valor ? origemConfig(c.chave) : null,
        mascarado: c.tipo === "secret" ? mascarar(valor) : null,
        valorVisivel: c.tipo !== "secret" ? valor ?? c.padrao : undefined,
      });
    }
    const { campos: _c, testar: _t, ...cabecalho } = i;
    void _c; void _t;
    integracoes.push({ ...cabecalho, campos, configurada: integracaoConfigurada(i), testavel: Boolean(i.testar) });
  }
  const pronto = lista.filter((i) => i.obrigatoria).every(integracaoConfigurada);
  return { integracoes, pronto, enderecoPublico: statusEnderecoPublico(), caixasEmail: statusCaixasEmail() };
}

/** URL pública do app, respeitando proxies (Render, Docker). */
export function baseUrl(req: Request): string {
  if (saasEnabled() || tenantId()) return appOrigin();
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Endereço público usado para montar links absolutos em e-mail/Slack (rotinas, lembretes, formulários,
 * pedidos). Nunca "localhost" fora de desenvolvimento: sem `APP_URL` configurada em produção, devolve
 * `undefined` e quem monta o link deve tratar (ex.: enviar sem link, ou avisar "endereço público
 * desconhecido"). Ver `registrarEnderecoPublico`, que preenche `APP_URL` sozinho a partir da primeira
 * requisição real que chegar numa rota que cria algo com link. */
export function enderecoPublico(): string | undefined {
  if (tenantId()) return appOrigin();
  const valor = getConfig("APP_URL");
  if (valor) return valor;
  if (process.env.NODE_ENV !== "production") return `http://localhost:${process.env.PORT || 3000}`;
  return undefined;
}

/** Grava `APP_URL` a partir do host real da requisição, para toda rota que cria uma rotina, um
 * lembrete, um formulário ou um pedido que vai gerar um link em e-mail/Slack mais tarde (quando não há
 * `req` disponível, como no executor de 60s). Nunca sobrescreve um valor vindo de variável de ambiente,
 * e só regrava quando o host muda (nova publicação, domínio próprio). */
export function registrarEnderecoPublico(req: Request): void {
  if (tenantId()) return;
  if (origemConfig("APP_URL") === "env") return;
  const atual = baseUrl(req);
  if (getConfig("APP_URL") === atual) return;
  setConfig("APP_URL", atual);
}

// Catálogo vivo de modelos do OpenRouter, agrupado em gratuitos e pagos. Cache de 1 hora em memória: a
// lista completa do catálogo não varia por usuário, então uma única cópia por processo basta. A lista
// fixa de lib/modelos.ts é só a rede de segurança de quem ainda não salvou chave (ou de um catálogo que
// não respondeu): o que a pessoa escolhe em /setup vem do provedor, não do código.
const CACHE_MODELOS_MS = 60 * 60 * 1000;
/** Quantos modelos de cada grupo entram no menu: o catálogo tem centenas, e uma lista que ninguém
 * consegue percorrer é tão inútil quanto uma lista fixa. Os maiores de contexto primeiro. */
const MODELOS_POR_GRUPO = 12;
let cacheModelosDinamicos: { expiraEm: number; modelos: Opcao[] } | null = null;

type ModeloCatalogo = { id: string; name?: string; context_length?: number };

async function modelosDinamicos(): Promise<Opcao[]> {
  if (cacheModelosDinamicos && cacheModelosDinamicos.expiraEm > Date.now()) return cacheModelosDinamicos.modelos;
  // This cache contains only the public catalogue; never populate it with account-scoped data.
  const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { data?: ModeloCatalogo[] };
  const catalogo = data.data ?? [];
  const porContexto = (a: ModeloCatalogo, b: ModeloCatalogo) => (b.context_length ?? 0) - (a.context_length ?? 0);
  const opcao = (m: ModeloCatalogo, grupo: Opcao["grupo"]): Opcao => ({ valor: m.id, rotulo: m.name || m.id, grupo });
  const gratuito = (m: ModeloCatalogo) => m.id.endsWith(":free");
  const recomendado = catalogo.find((m) => m.id === DEFAULT_MODEL);
  const modelos: Opcao[] = [
    ...(recomendado ? [opcao(recomendado, "recomendado")] : []),
    ...catalogo.filter((m) => gratuito(m) && m.id !== DEFAULT_MODEL).sort(porContexto).slice(0, MODELOS_POR_GRUPO).map((m) => opcao(m, "gratuito")),
    ...catalogo.filter((m) => !gratuito(m)).sort(porContexto).slice(0, MODELOS_POR_GRUPO).map((m) => opcao(m, "pago")),
  ];
  if (modelos.length === 0) throw new Error("catálogo vazio");
  cacheModelosDinamicos = { expiraEm: Date.now() + CACHE_MODELOS_MS, modelos };
  return modelos;
}

/** Opções de um campo de modelo: "Automático" na frente, o catálogo vivo depois. */
async function opcoesDeModelo(chave: string | undefined, automatico: Opcao): Promise<Opcao[]> {
  if (!chave) return [automatico, ...MODELOS_GRATUITOS];
  try {
    return [automatico, ...(await modelosDinamicos())];
  } catch {
    return [automatico, ...MODELOS_GRATUITOS];
  }
}

/** Integração de IA usada por todos os apps. Passe `visao: true` só nos apps que realmente leem
 * imagem (hoje `clone-site` e `custos-ia`) — os demais não ganham o campo "Modelo para imagens".
 * `avaliacao: true` acrescenta um segundo modelo, só para o que vira nota (hoje `simulador-vendas`):
 * um modelo rápido conversa e um mais capaz avalia, sem pagar caro nas duas pontas. `rotuloModelo`
 * renomeia o campo principal quando o app tem um nome melhor para o que a IA faz o tempo todo
 * (ex.: "Modelo para simulação"). `beneficio` é a frase de uma linha do cartão, em linguagem de
 * negócio e própria de cada app (ex.: "Liga a IA que gera o plano de desenvolvimento"). */
export function openrouter({
  visao = false,
  avaliacao = false,
  rotuloModelo = "Modelo de IA",
  beneficio = "Liga a IA que gera o resultado deste app",
}: { visao?: boolean; avaliacao?: boolean; rotuloModelo?: string; beneficio?: string } = {}): Integracao {
  const camposVisao: Campo[] = visao
    ? [{ chave: "OPENROUTER_MODEL_VISAO", rotulo: "Modelo para imagens", tipo: "select", opcional: true, avancado: true, padrao: MODELOS_VISAO[0].valor, opcoes: MODELOS_VISAO, ajuda: "Modelo usado quando o app precisa ler uma imagem" }]
    : [];
  const automaticoPadrao: Opcao = { valor: MODELO_AUTOMATICO, rotulo: "Automático (o app escolhe)" };
  const automaticoAvaliacao: Opcao = { valor: MODELO_AUTOMATICO, rotulo: `Automático (o mesmo de "${rotuloModelo}")` };
  const camposAvaliacao: Campo[] = avaliacao
    ? [
        {
          chave: "OPENROUTER_MODEL_AVALIACAO",
          rotulo: "Modelo para avaliação",
          tipo: "select",
          opcional: true,
          padrao: MODELO_AUTOMATICO,
          opcoes: [automaticoAvaliacao, ...MODELOS_GRATUITOS],
          ajuda: "Um modelo mais capaz só aqui deixa a nota mais confiável sem encarecer o resto.",
          opcoesDinamicas: async (config) => opcoesDeModelo(config.OPENROUTER_API_KEY, automaticoAvaliacao),
        },
      ]
    : [];
  return {
    id: "openrouter",
    titulo: "Inteligência artificial",
    descricao: "Uma conta gratuita no OpenRouter dá acesso a dezenas de modelos, vários sem custo. Conecte em um clique ou cole uma chave.",
    beneficio,
    obrigatoria: true,
    link: { url: "https://openrouter.ai/keys", rotulo: "Criar uma chave gratuita" },
    oauth: { tipo: "openrouter", rotulo: "Conectar a IA", url: "/api/setup/oauth/openrouter" },
    notaConexao: "Conta gratuita do OpenRouter basta. Os modelos gratuitos têm limite diário; créditos ampliam o limite e liberam modelos melhores.",
    campos: [
      { chave: "OPENROUTER_API_KEY", rotulo: "Chave da API", tipo: "secret", placeholder: "sk-or-v1-..." },
      {
        chave: "OPENROUTER_MODEL",
        rotulo: rotuloModelo,
        tipo: "select",
        opcional: true,
        padrao: MODELO_AUTOMATICO,
        opcoes: [automaticoPadrao, ...MODELOS_GRATUITOS],
        ajuda: 'Automático já funciona. Se aparecer "sem crédito" ou "limite diário", troque por outro gratuito ou adicione créditos.',
        opcoesDinamicas: async (config) => opcoesDeModelo(config.OPENROUTER_API_KEY, automaticoPadrao),
      },
      ...camposAvaliacao,
      ...camposVisao,
    ],
    testar: async (config) => {
      const chave = config.OPENROUTER_API_KEY;
      if (!chave) return { ok: false, mensagem: "Nenhuma chave salva ainda." };
      const r = await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${chave}` } });
      if (!r.ok) {
        const detalhe = await r.text().catch(() => "");
        return { ok: false, mensagem: interpretarFalha(r, detalhe).message };
      }
      const data = (await r.json()) as { data?: { limit?: number | null; usage?: number; is_free_tier?: boolean } };

      const modelo = modelName();
      const resposta = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelo, messages: [{ role: "user", content: 'Responda só "ok".' }], max_tokens: 5 }),
      });
      if (!resposta.ok) {
        const detalhe = await resposta.text().catch(() => "");
        return { ok: false, mensagem: interpretarFalha(resposta, detalhe).message };
      }

      const limite = data.data?.limit;
      const restantes = limite != null ? Math.max(0, limite - (data.data?.usage ?? 0)) : null;
      const plano = data.data?.is_free_tier
        ? "Plano gratuito: fique nos modelos gratuitos ou adicione créditos."
        : restantes != null
          ? `Créditos: US$ ${restantes.toFixed(2)} restantes.`
          : `Uso até agora: US$ ${Number(data.data?.usage ?? 0).toFixed(2)}.`;
      return { ok: true, mensagem: `Conectado e testado com sucesso. ${plano}` };
    },
  };
}

/** Por onde o app avisa você quando um formulário chega ou uma rotina roda. */
export const NOTIFICACOES: Integracao = {
  id: "notificacoes",
  titulo: "Notificações",
  descricao: "Escolha por onde o app avisa você quando um formulário público chega ou uma rotina roda: e-mail ou Slack.",
  beneficio: "Avisa você quando um formulário ou rotina precisar de atenção",
  obrigatoria: false,
  link: { url: "https://resend.com/api-keys", rotulo: "Criar uma chave gratuita do Resend" },
  campos: [
    { chave: "NOTIFICACOES_CANAL", rotulo: "Canal", tipo: "select", padrao: "email", opcoes: [{ valor: "email", rotulo: "E-mail" }, { valor: "slack", rotulo: "Slack" }] },
    { chave: "NOTIFICACOES_DESTINO", rotulo: "Destino", tipo: "text", opcional: true, placeholder: "voce@empresa.com", ajuda: "Para e-mail, o endereço que recebe. Para Slack, opcional (sobrepõe o canal padrão do webhook)." },
    { chave: "NOTIFICACOES_RESEND_API_KEY", rotulo: "Chave do Resend", tipo: "secret", opcional: true, avancado: true, placeholder: "re_...", ajuda: "Alternativa a conectar o Gmail/Outlook acima, ou ao SMTP abaixo.", visivelQuando: { campo: "NOTIFICACOES_CANAL", valores: ["email"] } },
    { chave: "NOTIFICACOES_SLACK_WEBHOOK", rotulo: "URL do webhook de entrada do Slack", tipo: "secret", opcional: true, placeholder: "https://hooks.slack.com/services/...", visivelQuando: { campo: "NOTIFICACOES_CANAL", valores: ["slack"] } },
    { chave: "NOTIFICACOES_SMTP_HOST", rotulo: "Servidor SMTP", tipo: "text", opcional: true, avancado: true, placeholder: "smtp.seudominio.com" },
    { chave: "NOTIFICACOES_SMTP_PORTA", rotulo: "Porta SMTP", tipo: "text", opcional: true, avancado: true, placeholder: "587" },
    { chave: "NOTIFICACOES_SMTP_USUARIO", rotulo: "Usuário SMTP", tipo: "text", opcional: true, avancado: true },
    { chave: "NOTIFICACOES_SMTP_SENHA", rotulo: "Senha SMTP", tipo: "secret", opcional: true, avancado: true },
  ],
  testar: async (config) => {
    const canal = (config.NOTIFICACOES_CANAL as Canal | undefined) || "email";
    return enviar({
      canal,
      destino: config.NOTIFICACOES_DESTINO,
      titulo: "Mensagem de teste",
      texto: "Se você recebeu isto, as notificações deste app estão prontas para uso.",
    });
  },
};

/**
 * Molde para uma integração MCP externa que a pessoa autoriza em um clique (botão "Autorizar",
 * via lib/mcp-oauth.ts) em vez de precisar colar um código manualmente. O código manual continua
 * disponível dentro de "Opções avançadas", para servidores que não suportam OAuth.
 */
export function integracaoMCP(opts: {
  id: string;
  titulo: string;
  descricao: string;
  ajudaUrl: string;
  /** Endereço sugerido quando este serviço tem um único destino conhecido (ex.: outro app da própria suíte). */
  urlPadrao?: string;
  /** Palavra usada na mensagem do teste de conexão (ex.: "Ações", "Consultas", "Ferramentas"). */
  rotuloFerramentas: string;
  /** Campos próprios desta integração além de endereço e código (ex.: nome de uma ferramenta específica). Sempre em "Opções avançadas". */
  camposExtras?: Campo[];
  /** Validação extra depois de listar as ferramentas remotas (ex.: conferir se a ferramenta escolhida existe). */
  testarExtra?: (ferramentas: FerramentaMCP[]) => { ok: boolean; mensagem: string } | undefined;
}): Integracao {
  const prefixo = opts.id.toUpperCase().replace(/-/g, "_");
  return {
    id: opts.id,
    titulo: opts.titulo,
    descricao: opts.descricao,
    obrigatoria: false,
    oauth: { tipo: "mcp", rotulo: "Autorizar", url: `/api/setup/oauth/mcp/${prefixo}` },
    campoConectado: `${prefixo}_CODIGO`,
    campos: [
      {
        chave: `${prefixo}_URL`,
        rotulo: "Endereço",
        tipo: "text",
        placeholder: "https://seu-servico.exemplo.com/mcp",
        ajuda: opts.ajudaUrl,
        padrao: opts.urlPadrao,
      },
      {
        chave: `${prefixo}_CODIGO`,
        rotulo: "Código de acesso",
        tipo: "secret",
        opcional: true,
        avancado: true,
        ajuda: "Alternativa ao botão Autorizar: cole aqui um código de acesso gerado manualmente no serviço.",
      },
      ...(opts.camposExtras ?? []),
    ],
    testar: async () => {
      const conexao = await conexaoAutorizada(prefixo);
      if (!conexao) return { ok: false, mensagem: "Autorize com o botão acima ou informe o endereço e o código de acesso antes de testar." };
      try {
        const ferramentas = await listarFerramentas(conectar(conexao.url, conexao.token));
        if (ferramentas.length === 0) return { ok: true, mensagem: `Conectado, mas o serviço ainda não expõe nenhuma ${opts.rotuloFerramentas.toLowerCase().replace(/s$/, "")}.` };
        const extra = opts.testarExtra?.(ferramentas);
        if (extra) return extra;
        return { ok: true, mensagem: `Conectado. ${opts.rotuloFerramentas} disponíveis: ${ferramentas.map((f) => f.nome).join(", ")}.` };
      } catch (err) {
        return { ok: false, mensagem: err instanceof Error ? err.message : "Não foi possível conectar ao serviço." };
      }
    },
  };
}

/** Quadro de tarefas externo (outro app da suíte, como o Agente de quadro, ou qualquer servidor MCP compatível) que recebe as ações geradas aqui como cartões. */
export const MCP_TAREFAS: Integracao = integracaoMCP({
  id: "mcp-tarefas",
  titulo: "Quadro de tarefas (MCP)",
  descricao: "Conecte um quadro de tarefas (como o Agente de quadro desta suíte) para transformar as ações desta conversa em cartões onde o seu time já trabalha.",
  ajudaUrl: "Copie do cartão \"Usar dentro do seu assistente\", no setup do quadro de tarefas.",
  rotuloFerramentas: "Ações",
});

/** CRM ou sistema de atendimento externo (como HubSpot, Zendesk ou Intercom, que expõem um servidor MCP dentro da própria conta) que recebe os leads e negócios gerados aqui, ou de onde importamos tickets de atendimento. */
export const MCP_CRM: Integracao = integracaoMCP({
  id: "mcp-crm",
  titulo: "CRM (MCP)",
  descricao: "Conecte o CRM ou sistema de atendimento onde o seu time trabalha (HubSpot, Zendesk e Intercom, por exemplo, expõem um servidor MCP nas configurações de integrações da conta) para mandar contatos e negócios ou importar tickets direto daqui.",
  ajudaUrl: "No HubSpot, no Zendesk ou no Intercom, fica em Configurações › Integrações › Conectar aplicativos privados/MCP. Copie o endereço mostrado lá.",
  rotuloFerramentas: "Ações",
});

/** Sistemas internos da empresa (pedidos, estoque, ERP...) que um assistente pode consultar via MCP antes de responder. */
export const MCP_EMPRESA: Integracao = integracaoMCP({
  id: "mcp-empresa",
  titulo: "Sistemas da empresa (MCP)",
  descricao: "Conecte os sistemas onde ficam pedidos, estoque ou outros dados do seu negócio (um ERP, uma planilha compartilhada, um CRM — o que já expuser um servidor MCP) para o assistente consultar dados reais antes de responder.",
  ajudaUrl: "Copie do painel de integrações do seu ERP/CRM, ou do cartão \"Usar dentro do seu assistente\" de outro app desta suíte.",
  rotuloFerramentas: "Consultas",
});

/** Fonte de dados externa (uma planilha viva, um ERP, ou qualquer serviço que exponha um servidor MCP) para ler números sempre atualizados sem depender de exportação manual de CSV. */
export const MCP_DADOS: Integracao = integracaoMCP({
  id: "mcp-dados",
  titulo: "Fonte de dados (MCP)",
  descricao: "Conecte a planilha viva ou o ERP onde seus dados já vivem (qualquer serviço que exponha um servidor MCP) para ler direto de lá, sem exportar CSV toda vez.",
  ajudaUrl: "Copie do painel de integrações do seu ERP/planilha, ou do cartão \"Usar dentro do seu assistente\" de outro app desta suíte.",
  rotuloFerramentas: "Ferramentas",
  camposExtras: [
    {
      chave: "MCP_DADOS_FERRAMENTA",
      rotulo: "Nome da ferramenta de leitura",
      tipo: "text",
      opcional: true,
      avancado: true,
      placeholder: "ex.: ler_planilha",
      ajuda: "Deixe em branco para o app tentar identificar sozinho pelo nome das ferramentas disponíveis.",
    },
    {
      chave: "MCP_DADOS_ARGUMENTOS",
      rotulo: "Argumentos da ferramenta (JSON)",
      tipo: "text",
      opcional: true,
      avancado: true,
      placeholder: '{"aba": "Despesas"}',
      ajuda: "Só quando a ferramenta escolhida exigir parâmetros extras, como o nome de uma aba ou um período.",
    },
  ],
  testarExtra: (ferramentas) => {
    const escolhida = getConfig("MCP_DADOS_FERRAMENTA");
    if (escolhida && !ferramentas.some((f) => f.nome === escolhida)) {
      return { ok: false, mensagem: `Conectado, mas a ferramenta "${escolhida}" não existe nessa fonte. Ferramentas disponíveis: ${ferramentas.map((f) => f.nome).join(", ")}.` };
    }
    return undefined;
  },
});
