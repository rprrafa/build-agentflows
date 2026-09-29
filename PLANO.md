# Plano: experiência Agentflows v2 no Build Agentflows

Objetivo: deixar a criação de fluxos de agentes com UI e UX muito próximas do
[Flowise Agentflows v2](../../flowise/packages/ui/src/views/agentflowsv2), mantendo
o produto enxuto (sem RAG, chatflows, marketplace) e conectado somente ao ChatGPT.

## Diagnóstico (20/09/2026)

O que já existe e fica: biblioteca de fluxos em grade/lista, editor em tela cheia
com React Flow, motor sequencial com aprovação humana, publicação com versão,
execução por HTTP e MCP, login ChatGPT por dispositivo.

O que afasta da experiência do Flowise:

1. **Conexões**: pontos redondos pequenos dos dois lados; arestas cinza iguais;
   sem botão para remover a aresta; rótulos dos ramos dentro do bloco; sem linha
   de conexão própria; nada acontece ao soltar uma conexão no vazio; ciclos livres.
2. **Blocos**: cartão largo de 250px com fundo pastel. No Flowise o cartão é
   compacto (`max-content`), fundo é a cor do bloco clareada, borda translúcida
   que escurece no hover/seleção, ícone quadrado colorido, pílulas do modelo e
   das ferramentas abaixo do nome.
3. **Paleta**: painel lateral fixo. No Flowise há um botão `+` flutuante no canto
   superior esquerdo, um botão ✨ para gerar o fluxo por IA e um popover com busca
   e categorias em acordeão.
4. **Chat de teste**: painel lateral. No Flowise é um botão de chat no canto
   superior direito que abre um popover com balões de mensagem, etapas executadas
   expansíveis e histórico da sessão.
5. **Implantação**: um único diálogo com um comando. No Flowise o diálogo de
   integração tem abas (cURL, Python, JavaScript...) e a publicação fica visível.
6. **Gerador de fluxos por IA**: inexistente.

## Stack

Mantida: Next.js 16, React 19, Tailwind 4 e `@xyflow/react` 12 (sucessor direto
do `reactflow` 11 usado pelo Flowise: mesmos conceitos de `Handle`, `NodeToolbar`,
`EdgeLabelRenderer`, `getBezierPath`). O MUI do Flowise não entra: o PADRAO.md da
suíte proíbe bibliotecas de UI, e o visual é reproduzido em CSS próprio.

## Etapas

Cada etapa termina com `npm test`, `npm run lint` e um commit próprio. Todas as
seis foram concluídas em 20/09/2026; a verificação visual foi feita com
Playwright em tela larga, tema escuro e celular.

1. **Conexões e blocos ao estilo Flowise** — bloco compacto com cores do
   Flowise, alça de entrada em barra, alças de saída em círculo com seta
   visíveis no hover, aresta com gradiente entre as cores dos blocos, botão de
   remoção no meio da aresta, rótulo do ramo na origem, linha de conexão animada,
   validação de conexão (sem ciclos fora do bloco Repetir, sem auto-conexão,
   uma conexão por saída) e criação de bloco ao soltar uma conexão no vazio.
2. **Paleta flutuante e gerador por IA** — botões `+` e ✨ no canto superior
   esquerdo, popover com busca e categorias, diálogo "O que você quer construir?"
   que pede ao ChatGPT um fluxo completo (blocos, conexões, instruções) e o
   coloca no quadro com layout automático.
3. **Diálogo de edição do bloco** — cabeçalho com ícone colorido, nome editável
   em linha, campos organizados, modelo e ferramentas como seleção, referências
   como atalhos de inserção.
4. **Chat de teste em popover** — botão de chat, histórico de mensagens da
   sessão, etapas executadas dentro da resposta, aprovação em linha, limpar
   conversa, expandir.
5. **Opções de implantação** — diálogo com abas (Publicação, cURL, JavaScript,
   Python, MCP) e estado de publicação no cabeçalho.
6. **Fechamento** — README, CLAUDE.md, verificações da suíte, versão.

## Fora do recorte (próximos passos possíveis)

- Página pública de chat para compartilhar um fluxo publicado (Share Chatbot
  do Flowise).
- Início por formulário ou agendamento, além da conversa.
- Notas adesivas no quadro e bloco de iteração sobre listas.

# Rodada 2 (20/09/2026): simplificação para executivos, conexões e canais

Pedidos recebidos depois da primeira rodada, agrupados em etapas. Cada etapa
termina com testes, lint e um commit próprio. As sete etapas foram concluídas
em 20/09/2026 (versão 0.3.0), com verificação visual por Playwright.

## A. Ajustes de UX no editor e na biblioteca

- Nome do bloco editado direto no título do diálogo (sem campo repetido).
- Sem a marca "V2" no menu, no cabeçalho e no rodapé.
- "Gerar com IA" passa a se chamar "LLM (Assistente)"; "Agente" continua.
- Blocos novos nascem com nome incremental (Agente 0, Agente 1, LLM 0…), como
  no Flowise, e o nome pode ser trocado direto no cabeçalho do bloco.
- Biblioteca com paginação de 10, 20, 50 ou 100 fluxos por página.
- Mensagem de confirmação em todas as cópias (código do ChatGPT, código de
  acesso, exemplos) e nas ações sem retorno visível (publicar, duplicar, importar).

## B. Variáveis sem esforço

- `{{input}}` deixa de ser obrigatório: um LLM ou Agente com a mensagem em
  branco recebe automaticamente a conversa (no primeiro passo) ou o resultado
  da etapa anterior, como o Flowise encadeia os nós. A validação e o gerador
  acompanham.
- Ao digitar `{{` em qualquer campo de texto aparece um autocompletar com a
  entrada, a etapa anterior, as variáveis de estado e os blocos do fluxo. Somem
  os atalhos separados acima dos campos.

## C. Conexões: OpenRouter ao lado do ChatGPT

- Página Conexões no menu, com cartões: ChatGPT (principal, assinatura),
  OpenRouter (OAuth em um clique, mais de 500 modelos), Ferramentas (MCP),
  WhatsApp e ElevenLabs.
- O seletor de modelo do LLM/Agente lista os modelos do ChatGPT e, quando o
  OpenRouter está conectado, os modelos dele agrupados por provedor. O motor
  roda o modelo escolhido: ChatGPT pelo Codex, OpenRouter por chamada direta
  com as mesmas ferramentas.

## D. Ferramentas como no Flowise

- Ferramentas prontas, sem configurar: data e hora, calculadora, requisição
  HTTP, executar outro fluxo publicado, enviar WhatsApp e ligar por voz (as
  duas últimas quando o canal está conectado).
- Vários servidores MCP nomeados (endereço + autorização em um clique ou
  código), cada um listando suas ferramentas.
- No Agente, as ferramentas aparecem agrupadas por origem e são marcadas por
  clique; o bloco mostra as escolhidas.

## E. WhatsApp

- Provedores: Z-API (conexão por QR Code), Meta (oficial) e ZapperHub, com
  o mesmo contrato de envio e recebimento.
- Bloco "Enviar WhatsApp" e ferramenta "enviar_whatsapp" para o Agente.
- Mensagens recebidas executam o fluxo publicado escolhido em Conexões e a
  resposta volta pelo mesmo número.

## F. ElevenLabs (voz)

- Chave, voz, agente de conversa e número em Conexões.
- No chat de teste: falar em vez de digitar (transcrição) e ouvir a resposta.
- Bloco "Ligação por voz" e ferramenta "ligar_por_voz" para prospecção ativa;
  o fim da ligação (inbound ou outbound) executa o fluxo escolhido com a
  transcrição, para registrar ou dar sequência.

## G. Fechamento

- README, CLAUDE.md, verificações da suíte, versão 0.3.0.

## Fora do recorte da rodada 2

- Conexão do WhatsApp por QR Code dentro do app (hoje o QR Code é lido no
  painel do provedor; o app confere o estado no botão Testar).
- Ligações recebidas atendidas diretamente pelo fluxo (hoje o agente de
  conversa da ElevenLabs atende e o fluxo recebe a transcrição ao final).
- Modelos de exemplo com WhatsApp e voz.

# Rodada 3 (20/09/2026): acabamento para executivos

Concluída na versão 0.4.0, com testes e verificação visual por Playwright.

## A. Editor

- Limpar conversa pede confirmação; sair com alterações abre um modal no
  padrão da interface (continuar, sair sem salvar, salvar e sair).
- Botão Salvar inativo quando não há mudanças; qualquer alteração o reativa.
- Renomear o bloco salva com Enter ou pelo check, no cabeçalho do bloco e no
  título do diálogo.
- Paleta sem o "+" por item e sem os blocos Ferramenta, Enviar WhatsApp e
  Ligação por voz (ferramentas vivem no Agente; canais em Implantar).

## B. Ferramentas como no Flowise

- Catálogo por categoria com os mesmos serviços: Tavily, SearchApi, Exa,
  Serper, SerpApi, Brave, Google Custom Search, SearXNG, arXiv, Wolfram Alpha,
  ler página, requisição HTTP, extrair JSON, data e hora, calculadora e
  executar fluxo. WhatsApp e ligações ficam fora do Agente: o canal é ligado
  ao fluxo completo em Implantar.
- Credencial pedida dentro do Agente na primeira vez; vale para todos os fluxos.

## C. Provedores e canais

- "Automático · OpenRouter" no seletor de modelo.
- ElevenLabs em Conexões só com a chave e o teste; a voz é escolhida no chat de
  cada fluxo ao ligar "Ouvir respostas".
- Implantar ganha as abas WhatsApp (vincular este fluxo ao número) e Ligações
  (agente, número, segredo, vínculo da transcrição e ligar agora).

## Fora do recorte da rodada 3

- Ferramentas do Flowise que dependem de OAuth de terceiros (Gmail, Google
  Agenda/Planilhas/Drive, Jira, Slack, Teams, Outlook): entram por servidores
  MCP em Conexões.
- Ferramentas que exigem navegador ou execução de código (Web Browser, Code
  Interpreter).

# Rodada 4 (20/09/2026): conexões, limites e ferramentas — 0.5.0

- Remover ferramentas de Conexões e alinhar os quatro cartões.
- Mostrar termos StartSe para WhatsApp não oficial e registrar o aceite por provedor.
- Ocultar exemplos e simulação do chat com IA conectada; centralizar limpar, expandir e fechar no topo.
- Consultar limites e renovação da assinatura pelo protocolo oficial do Codex.
- Completar as 24 ferramentas solicitadas, mantendo as existentes; seleção por agente e credencial compartilhada por serviço.
- Gerenciar credenciais e servidores no Agente, com edição, autorização, teste e remoção.
- Testes de contratos, motor com dois agentes, navegador desktop/celular, lint, build e verificadores da suíte antes de publicar na main.

As limitações das rodadas anteriores sobre Gmail, Google/Microsoft, Browserless, Slack, E2B e arquivos foram superadas por esta rodada. Configuração, ações e limites atuais estão documentados no README.

# Rodada 5: ferramentas e servidores em cartões — 0.6.0

- Inclusão progressiva por **Adicionar ferramenta** e **Adicionar servidor MCP**.
- Um cartão recolhível por ferramenta ou servidor, com seleção e configuração no próprio item.
- Credenciais compartilhadas, permissões individuais por agente e remoção local separada da exclusão global da conexão.
- Ações MCP por servidor: descrição, busca, seleção individual/em lote, atualização independente e recuperação de indisponibilidade sem apagar seleções.
- Compatibilidade com fluxos anteriores e persistência de servidores anexados sem ações selecionadas.
- Testes de comportamento/contrato e navegação com dois MCP locais, desktop, tema escuro e celular; lint, build e verificadores da suíte.

# Rodada 6: chat com anexos e Configurações — 0.7.0

- Fechamento externo e Esc para chat, paleta, histórico e menu do cabeçalho; rascunho preservado ao reabrir o chat.
- Compositor com altura automática, envio, anexos, colagem, arrastar/soltar e voz.
- Uploads privados e limitados; documentos extraídos como texto e imagens enviadas nativamente apenas a modelos compatíveis, com validação no servidor antes da execução.
- Configurações com modelos compactos, limites expansíveis e formulários dos canais recolhidos; compatibilidade da URL anterior.
- Remoção da busca do seletor OpenRouter; nova versão também no rodapé da sidebar.
- Testes de anexos, permissões entre fluxos, contratos dos provedores e motor; navegação desktop/celular, tema escuro, lint, build e verificadores da suíte antes do push na main.

# Rodada 7: conversa natural por voz — 0.8.0

- Compositor limpo, mantendo validação de anexos e removendo avisos permanentes, provedor e Ouvir respostas.
- Botão de conversa por voz, esfera animada, detecção de pausa, envio automático e resposta falada; silenciar, interromper e encerrar.
- Voz persistida por fluxo no modal do cabeçalho, incluindo cópias, exportação e importação.
- Continuidade por contexto das últimas seis execuções da conversa; aprovação humana continua explícita.
- Cancelamento e limpeza do microfone/áudio, respostas tardias ignoradas e estados de erro/repetição.
- Testes do ciclo de voz e contexto, contratos ElevenLabs, navegador com MediaRecorder/Web Audio reais e áudio sintético; lint, build e verificadores antes de commit/push.

# Rodada 8: Base de Conhecimento — 0.11.0

O pedido de 25/09/2026 supera a exclusão histórica de RAG deste plano. A jornada Document Store do Flowise passa a fazer parte do produto: 20 extratores em ordem alfabética, revisão/edição de fragmentos, Embeddings, Vector Store, Record Manager, indexação com histórico, consulta e seleção no Agente com referências opcionais. Consulte KNOWLEDGE.md e KNOWLEDGE-PLAN.md para implementação e evidências.
