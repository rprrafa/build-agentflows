# Aplicação multi-tenant — Drizzle e PostgreSQL

## Diretriz atual do produto

A aplicação será exclusivamente SaaS. Por decisão do usuário em 29/09/2026,
remover o modo de conta única/SQLite, os fallbacks, variáveis de bypass e nomes
que distingam artificialmente a versão SaaS. Não implementar importador SQLite
nem manter compatibilidade de execução com o legado. Preservar funcionalidades
úteis migrando-as para o contexto privado de cada usuário.

Um tenant pessoal corresponde a um usuário autenticado. O ID vem da sessão ou
do job validado; `user_id` participa das chaves e relações dos recursos. Não há
seleção de tenant por um campo arbitrário enviado pelo cliente.

Drizzle já define as 29 tabelas em `lib/db/schema.ts`, sem prefixo `saas_`, e gera
as migrações em `drizzle/`. O pool PostgreSQL e as transações expõem o ORM tipado;
o repositório de credenciais já usa suas operações. A conversão das demais
consultas e remoção dos módulos legados está em andamento. SQL parametrizado
continua disponível para travas e operações atômicas específicas.

A migração gerada foi validada em PGlite e PostgreSQL 17.7 real: **49 testes de
tenant passaram em ambos**, com bancos descartáveis por arquivo e conexões
concorrentes. A configuração e os testes não acessam `DATABASE_URL` de produção.
`PG_BIN_DIR=/caminho/postgres/bin npm run test:postgres` repete o teste real.
A suíte geral com Drizzle passou **262/262**. Build e TypeScript passaram; lint
sem erros, com o aviso preexistente de `<img>` no chat.

Autenticação de conta única removida: `lib/conta.ts`, tela antiga e `/api/conta/*`
foram excluídos. A interface usa sessão/logout de `/api/auth/*`; o proxy não aceita
mais `CONTA_DESLIGADA`. A inicialização exige PostgreSQL e aplica as migrações
Drizzle. Validação: **262 testes gerais e 50 cenários no PostgreSQL servidor**.
Os repositórios e integrações legados restantes ainda precisam ser convertidos;
a remoção do modo antigo não está concluída.

APIs privadas de fluxos e execuções agora exigem sessão sem fallback por ausência
de `DATABASE_URL`; criação e retomada passam pela fila. Testes HTTP usam contas,
sessões e bancos isolados, incluindo memória de conversa executada pelo worker.
A suíte geral passou 261 testes (removido um teste de importação legada, recurso
descartado pela diretriz atual); build passou. Restam os repositórios internos e
as integrações públicas listadas abaixo.

Fila: uma tarefa por usuário e duas globais, incluindo fluxos, extração e
indexação. Cancelamento mantém a vaga até confirmação do worker ou recuperação
da autorização expirada. Testes cobrem concorrência entre usuários, tipos de
tarefa, cancelamento e crash. Docker agora disponível: imagem Linux ARM64 e
Compose testados com API autenticada, dois workers e recriação dos containers
preservando volumes. `npm run test:docker` reproduz o teste em ambiente isolado.
O Compose local usa os mesmos serviços do Coolify; a validação não acessa
credenciais nem dados reais e não confirma integrações externas.
Validação desta etapa: **266 testes gerais e 55 testes no PostgreSQL servidor**;
lint sem erros (permanece o aviso anterior de `<img>` no chat).

Removidos módulos herdados sem consumidores no Agentflows: formulários públicos
(nenhum criador/callback registrado), rotinas (catálogo e executores vazios) e
histórico genérico `resultados` (a tela atual usa `runs`). As rotas e exceções
públicas correspondentes foram excluídas. Não criar tabelas novas para conservar
essas estruturas antigas. O inventário histórico abaixo deve ser lido com essa
correção de escopo; a jornada real de execuções continua por tenant.
Também removidos a interface genérica sem importadores, o catálogo vazio de
integrações, helpers exclusivos dessas telas e endpoints de setup que apenas
retornavam 410. As conexões atuais usam `APP_URL` validado diretamente e não
inferem a origem por cabeçalhos. Nas APIs privadas, tenant e estado OAuth são
obrigatórios; extração e indexação sempre entram na fila.
Validação da remoção: **267 testes gerais e 56 no PostgreSQL servidor**, build
concluído e lint sem erros. Teste HTTP OAuth cobre origem forjada, estado ausente,
estado de outra conta, armazenamento privado e tentativa de repetição.

Chat incorporado migrado para PostgreSQL: tickets e sessões vinculados ao dono,
visitante, origem e chave; anexos privados por conversa; comandos atômicos e
mensagens executadas pela fila compartilhada. O worker exclusivo e as tabelas
SQLite do embed foram removidos. Detalhes em [EMBED-TENANTS.md](EMBED-TENANTS.md).
Validação atual: **281 testes gerais e 76 no PostgreSQL servidor**, build e lint
sem erros (um aviso preexistente no avatar). Docker passou com dois workers,
chat público, isolamento e volumes. Navegador passou com contas A/B, preview em
iframe, envio, recarga e layouts desktop/celular, usando serviços locais.

MCP público e webhook de fluxos migrados: chave cifrada da conta, rotação e
revogação independentes, autenticação antes das ferramentas e contadores
persistidos. Execução e aprovação usam a fila compartilhada; HTTP retorna 202
com consulta por ID. O SDK MCP substitui a implementação manual de protocolo.
Detalhes em [INTEGRATION-TENANTS.md](INTEGRATION-TENANTS.md).
Validação: **288 testes gerais e 84 no PostgreSQL servidor**, incluindo o cliente
MCP oficial e acesso A/B aos handlers. Build passou; lint sem erros, com o mesmo
aviso preexistente do avatar. Docker passou com cliente MCP oficial pela rede,
webhook enfileirado, contas A/B, worker e consulta após recriar containers.
Navegador passou novamente em desktop/celular. WhatsApp/ElevenLabs ainda exigem
migração dos canais.

Sessão ChatGPT persistida em `chatgpt_sessions` cifrada por usuário, com trava
entre app e workers, renovação, revogação e bloqueio de gravações antigas. O
arquivo nativo fica em área temporária privada; app/worker usam tmpfs no Compose.
Processos encerram ao fim da operação, salvo login pendente com prazo de dez
minutos. A migração exige reconectar contas que usavam o cache anterior, removido
ao abrir a nova conexão. Consulte [CHATGPT-SESSIONS.md](CHATGPT-SESSIONS.md).
Validação: **296 testes gerais e 92 no PostgreSQL servidor**, build aprovado e
lint sem erros (aviso preexistente no avatar). Docker passou com tmpfs, Codex
instalado sem credenciais reais, login/turno simulado, persistência cifrada após
recriar containers, dois workers e navegação desktop/celular.

## Histórico e inventário técnico (em revisão após a mudança de direção)

Etapa de imagens validada com **280 testes gerais e 57 no PostgreSQL servidor**,
build e lint sem erros (aviso preexistente no EmbedChat). A imagem Docker foi
reconstruída e o teste Compose passou com API autenticada, credenciais/anexos
privados, duas instâncias do worker, cota por usuário e recriação preservando
volumes. Testes de APIs pagas usam respostas controladas. A remoção restante do
legado e a migração das integrações públicas continuam pendentes.

O objetivo permanece integral: autenticação por senha/Google, Resend, beta fechado,
isolamento de **todo** contexto por usuário, credenciais cifradas, modelos
multimodais/geração de imagem (Replicate, Higgsfield, MuAPI), PostgreSQL, limites,
fila Redis com worker e deploy Coolify com volumes. Não publicar como SaaS antes
de concluir a migração e a auditoria abaixo.

## Estado verificado

A configuração `DATABASE_URL` é obrigatória na arquitetura alvo; os ramos
de compatibilidade existentes serão removidos na próxima etapa. **O modo SaaS ainda está em migração e
não está pronto para produção**: autenticação e biblioteca de fluxos já usam
PostgreSQL, assim como configurações, credenciais, anexos privados e conhecimento.
O motor privado, o chat incorporado e a fila/worker já usam os repositórios por
usuário. MCP público e webhook de fluxos usam Bearer da conta e a fila comum;
WhatsApp/ElevenLabs ainda estão pendentes. Esses caminhos não podem cair no SQLite global:
o armazenamento legado falha explicitamente quando há contexto SaaS ou
`DATABASE_URL`. Não liberar o beta enquanto houver funcionalidades pendentes.

Rotas e telas ligadas: `/conta`, `/entrar`, `/acesso`, `/verificar-email`,
`/recuperar-senha`, `/redefinir-senha`, `/api/auth/[action]` e Google
`/api/auth/google/callback`. Links de confirmação/recuperação usam fragmentos,
limpam a URL após leitura e só consomem o token por POST explícito. O envio está
na outbox, processada pelo worker dedicado. O cadastro não emite uma sessão
automaticamente. Uma sessão sem e-mail verificado ou aprovação só acompanha o
acesso; não abre os recursos privados.

Implementado em `lib/saas-*.ts`:

- Pool PostgreSQL limitado, transações e migração versionada com trava de deploy.
- Contas com senha scrypt assíncrona; sessões e ações de uso único persistidas
  somente como hashes. Recuperação invalida todas as sessões da conta.
- Confirmação de e-mail separada da aprovação do beta. Admin pode aprovar ou
  bloquear no banco; o controle de acesso consulta o estado atual, sem cache.
- Convites com validade, revogação, limite e auditoria por pessoa; uso e aprovação
  são uma transação, sem exceder a cota sob concorrência. Só contas verificadas
  resgatam convites. Repetir uma requisição aprovada não consome outra vaga.
- Google Authorization Code com PKCE, state vinculado ao navegador, nonce e
  validação criptográfica do ID token (emissor, audiência, validade e e-mail).
  Contas por senha não são vinculadas automaticamente por coincidência de e-mail.
- Outbox transacional cifrada para Resend, idempotência, leases, retentativas
  limitadas e remoção do conteúdo após envio/falha terminal. Falha de envio não
  perde o cadastro nem exige manter senha ou token em texto puro no banco.
- Repositório de credenciais por usuário, AES-256-GCM com contexto autenticado
  vinculado ao dono e ao nome da credencial. `CHAVE_MESTRA` inválida falha
  explicitamente; o SaaS nunca gera uma chave silenciosa diferente no worker.
- Rate limits atômicos compartilhados via PostgreSQL para cadastro, login,
  pedidos de e-mail, início do Google e resgate. Sem confiar automaticamente em
  `X-Forwarded-For` fornecido pelo cliente.
- Contexto obrigatório por operação (`tenant-context.ts`), derivado da sessão
  ou do usuário do job persistido, com revalidação de aprovação. Impede troca de
  dono em operação aninhada e invalida callbacks que escapem da operação.
- CRUD/publicação de fluxos e leitura/paginação de execuções ligados às rotas
  existentes no modo SaaS. Toda consulta inclui o dono, e os relacionamentos no
  banco têm FKs compostas. Aprovação de execução usa compare-and-swap; exclusão
  do fluxo compartilha trava com criação da execução.
- Motor privado, memória da conversa, aprovação/retomada, cancelamento e
  subfluxos usam `flow-service.ts` assíncrono. Histórico exige mesma conta e fluxo,
  conclusão e execução real. Cancelamento é transacional, não é sobrescrito por
  gravação atrasada e é observado também por polling do estado persistido.
  AbortControllers são separados por dono/execução. Subfluxos por ID ou nome
  são consultados apenas na biblioteca do dono, com profundidade máxima de cinco.
  A fila privada usa jobs PostgreSQL, notificações Redis e autorização temporária
  com verificação nas gravações do worker.
- Geração/edição por IA ligadas à sessão; streaming tem escopo próprio até
  terminar (`tenantJsonStream`), confirma configurações antes do resultado final
  e descarta alterações ao cancelar. Sinais de cancelamento chegam ao provedor.
  Progresso de execuções é gravado com fila local de promessas, esperada antes
  de fechar o contexto, e frequência de até uma atualização por 500 ms.
- Migração 2 com tabelas de fluxos, execuções, conhecimento e anexos em JSONB,
  proprietário nas chaves e relações. Migração 4 acrescenta armazenamento privado
  de conhecimento cifrado por usuário/base/recurso, gravado na mesma transação
  que fontes e configurações. Arquivos de fontes ficam nesse armazenamento, sem
  sobrecarregar o dicionário de configurações da conta.
- Conhecimento ligado às rotas existentes por `knowledge-service.ts` e
  `knowledge-index-service.ts`: CRUD, extração, fragmentos, indexação, consulta,
  referência por ferramentas do agente e limpeza. Implementação PostgreSQL em
  `tenant-knowledge.ts`/`tenant-knowledge-index.ts`; SQLite permanece só no legado.
  Travas por dono/base e tokens de validade limitada impedem gravações atrasadas
  após substituição da operação. Segredos de uma geração são persistidos antes
  de escrever serviços externos; publicação de vetores/índice é atômica.
  Falhas de limpeza ficam registradas para nova tentativa. Snapshots vetoriais
  são ligados à base, preservando versões retidas após edição de fragmentos.
  Quotas: 100 bases/conta, 100 fontes/base, 10.000 fragmentos/geração e 200 MiB de
  conteúdo privado cifrado por conta. Upload por fonte continua limitado a 10 MB.
  Extração/indexação privadas já entram na fila com limites por conta e globais.
  Falta validar capacidade total de dados vetoriais/conexões externas antes da liberação.
- Anexos SaaS usam `attachment-service.ts` assíncrono e a migração 3: conteúdo
  `bytea` e metadados no PostgreSQL, gravados/excluídos na mesma transação.
  Upload/download privados já validam sessão e dono; resolução, contexto de
  documentos/imagens e marcação de uso nunca aceitam anexo de outra conta/fluxo.
  Limite de 100 MB/2.000 anexos por conta e expiração de abandonados após um dia
  durante novos uploads. Exclusão do fluxo remove os bytes por FK composta.
  O embed exige ticket e vínculo com a conversa para upload/download; imagens
  geradas só podem ser baixadas pela conversa que as produziu.
- Diretórios de arquivos de ferramentas, FAISS e ChatGPT por usuário;
  rejeição de symlinks nos diretórios privados e namespaces por dono também nos
  provedores vetoriais/record managers externos.
- ChatGPT sem singleton compartilhado entre usuários, com até quatro conexões
  por processo, descarte de conexões ociosas e callbacks vinculados ao contexto
  do turno. A persistência nativa usa agora o cofre cifrado `chatgpt_sessions`,
  com trava entre processos e área temporária privada (tmpfs no Docker).
- APIs de autenticação e APIs de fluxos aplicam origem/CSRF, limitação real do
  corpo, respostas `no-store` e erros sem segredos. O proxy usa a sessão SaaS e
  ignora `CONTA_DESLIGADA` quando PostgreSQL está configurado; as rotas de recursos
  fazem a própria validação novamente.
- Configurações/credenciais de ferramentas, conexões, MCP cliente/OAuth,
  OpenRouter, voz e status ligados ao contexto por usuário. Não herdam chaves
  globais nem bloqueios de ambiente da instalação legada. Tokens de e-mail têm
  cache limitado por usuário/provedor; rotação também é privada.
- OAuth de integrações usa state cifrado vinculado à conta, serviço/endpoint e
  navegador/PKCE, com expiração e consumo único. Login Google e conexão OpenRouter
  usam contextos criptográficos distintos. Catálogo público OpenRouter não envia
  credencial de usuário e pode ser compartilhado sem dados privados.
- Fluxos validam referências a credenciais, bases e subfluxos do dono; execuções
  validam anexos do mesmo fluxo. Exclusão de credencial verifica bases, rascunhos,
  publicações e execuções ativas sob a mesma trava do usuário que a gravação.
- Páginas de resultado e impressão (`/r/[id]`, `/imprimir/[id]`) validam sessão e
  dono no Server Component. APIs privadas têm 120 chamadas/minuto por usuário e
  operações de custo elevado têm orçamento adicional de 20/minuto compartilhado.

`npm run test:saas` executa testes sobre PostgreSQL embarcado (PGlite), com
assinaturas JWT reais e transporte Resend simulado. É evidência de contratos e
SQL, não substitui teste de múltiplas conexões em PostgreSQL servidor, teste de
navegador ou envio/autorização reais nos provedores.

Validação desta etapa (29/09/2026): `npm test` passou **223/223**, incluindo 10
testes novos de SaaS; `npm run build` e TypeScript passaram. `npm run lint` terminou
sem erros, com um aviso existente sobre o avatar `<img>` em `EmbedChat.tsx`.
Foi corrigida a leitura impura do relógio durante o render desse componente;
o relógio agora é estado atualizado por um timer com limpeza no unmount.
Os testes de rede locais precisaram executar fora do sandbox, que bloqueava
`listen` em `127.0.0.1`. Nenhum envio real Resend ou login real Google foi realizado.

Validação da segunda etapa: testes A/B cobrem contexto assíncrono, credenciais,
CRUD/publicação, execuções/paginação, FKs de conhecimento/anexos, arquivos,
namespaces FAISS, processos ChatGPT e ferramentas executadas em um turno posterior
ao que iniciou o processo. Testes HTTP cobrem também cadastro → login pendente →
confirmação → convite → criação privada → recuperação/revogação. Lint e build
passaram após a ligação das telas e rotas; a validação de navegador ainda falta.
A suíte geral passou **231/231**. Dois cenários HTTP/contexto foram acrescentados
depois: a suíte focada passou **20/20** e TypeScript passou novamente. A última
suíte geral precede apenas esses dois novos testes, não alterações de produção.

Validação da terceira etapa: **241/241 testes gerais passaram**, incluindo
**28 testes SaaS**. Cobertura nova: rollback/savepoints de configuração, conflito
concorrente sem escrita parcial, credenciais de ferramentas A/B, publicação,
referências a bases, OAuth por conta/endpoint/navegador/expiração/replay, cache e
rotação de e-mail, anexos privados, contexto, expiração, quota e exclusão em
cascata. Build/TypeScript passaram; lint sem erros, mantendo o aviso de `<img>`.
As integrações externas foram simuladas, sem envio de e-mail real.

Validação da quarta etapa: a suíte geral passou **247/247**, com conhecimento
PostgreSQL e chamadas HTTP reais contra simuladores locais de embeddings/Qdrant.
Build/TypeScript passaram. Após acrescentar a remoção de fontes e fortalecer o
cenário de substituição da trava (somente testes), a suíte SaaS passou **35/35**.
Lint novamente sem erros, apenas o aviso existente de `<img>`.
Casos cobertos: CRUD A/B, credenciais cifradas e AAD por recurso, arquivos,
extração, contagens, fragmentos, lease substituído, recuperação de operação
abandonada, consulta pelo agente, namespace remoto, retenção e reúso de embeddings,
falha sem publicação parcial, limpeza pendente, remoção de fontes e referências
de fluxos/credenciais. Nenhum serviço externo real foi consumido.

Validação da quinta etapa: **253/253 testes gerais passaram**, incluindo
**40 cenários SaaS**. Build e lint passaram (um aviso existente de `<img>`);
TypeScript passou novamente após acrescentar o limite de recursão à ferramenta
genérica de subfluxos. Novos cenários cobrem execução privada, aprovação única,
cancelamento durante a chamada, prevenção de ressurreição por gravação atrasada,
histórico/subfluxos A/B, profundidade de encadeamento e ciclo de vida do streaming
(commit antes do resultado, invalidação do contexto, autenticação e descarte ao
cancelar). Os modelos foram simulados; não houve consumo externo real.

Validação da sexta etapa: **261/261 testes gerais passaram**, incluindo
**48 cenários SaaS**. Build e TypeScript passaram; lint sem erros, mantendo o
aviso existente de `<img>`. Redis **8.2.1 real**, compilado para teste isolado,
passou envio/consumo, indisponibilidade, persistência AOF e reconexão. Use
`REDIS_SERVER=/caminho/redis-server npm run test:redis` para repetir.

- Migração 5: jobs por dono/recurso, FKs compostas, lease e heartbeat do worker.
  Enfileirar execução/anexos ou decisão de aprovação e seu job é transacional.
- Worker mantém contexto do dono até confirmar credenciais; duas tarefas globais,
  uma por usuário, backlog de dez por usuário/mil total, autorização de 60 segundos
  renovada a cada dez, prazo de 15 minutos. PostgreSQL é a fila durável; Redis
  transporta só IDs. O worker também drena Resend e limpa dados expirados.
- Cancelamento revoga o job; gravações atrasadas são recusadas. Recuperação marca
  tarefas interrompidas sem repetir efeitos externos. Uma operação de conhecimento
  substituta não é alterada pela recuperação da antiga. Falha anterior ao motor
  também encerra o run, inclusive se a conta foi suspensa após reivindicar o job.
- APIs privadas retornam 202 e as telas acompanham o estado. Subfluxos recebem o
  cancelamento da execução pai. Uma decisão durante a finalização do job anterior
  recebe 409 e pode ser tentada novamente, sem consumir a aprovação.
- Compose de homologação inclui web/worker, PostgreSQL/Redis privados, volumes,
  healthchecks, limites e shutdown. A imagem inclui as dependências do worker.
  **Docker/Compose não foram executados neste ambiente**; YAML foi analisado,
  mas build da imagem, PostgreSQL servidor e teste entre processos seguem pendentes.

### Configuração limitada por operação

`tenant-config-state.ts` carrega somente o pequeno dicionário de configurações do
usuário para preservar os consumidores síncronos `getConfig/setConfig`. Não é
uma cópia das tabelas de fluxos ou conhecimento. Limites: 1.000 chaves, 4 MiB
de valores em memória e 256 KiB por valor; até 200 credenciais de ferramentas.
Metadados das credenciais ficam no índice cifrado `TOOL_CREDENTIAL_INDEX`; cada
conta de ferramenta tem seu segredo separado em `TOOL_ACCOUNT_<id>`.

As alterações ficam locais à operação e são confirmadas em uma transação antes
da resposta. Falha ou resposta HTTP de erro descarta as alterações; comparação
do ciphertext original evita sobrescrever mudanças concorrentes. Trava no dono
protege quotas e verificações de uso. Fluxos, anexos e demais recursos usam
consultas PostgreSQL assíncronas. Arquivos de fontes de conhecimento não devem
ser colocados nesse dicionário limitado ao portar o repositório.

Contextos não sobrevivem ao fim da operação: streams e workers precisam manter
um escopo próprio até terminar, sem callbacks que reutilizem contexto encerrado.
O motor e o streaming privado já mantêm esse ciclo de vida. Cada worker deve
abrir um contexto a partir do dono do job, sem capturar o contexto HTTP anterior.

## Próxima etapa: terminar isolamento e migração do armazenamento

Converter os repositórios síncronos para acesso assíncrono ao PostgreSQL.
O proprietário vem da sessão validada, do registro do job ou de um token público
validado; nunca do `user_id` enviado pelo navegador. A ausência de contexto deve
falhar, sem fallback para uma conta global. Validar acesso nas rotas e nos
repositórios, incluindo Server Components e workers; o proxy sozinho não basta.

| Domínio existente | Migração e invariante exigida |
| --- | --- |
| `config`, `tool_credentials`, setup, MCP/OAuth, canais | Dono obrigatório; segredos cifrados e metadados separados. Não herdar chaves globais de IA para usuários novos. |
| `flows`, publicação, `flow_runs` | Dono nos registros; FK composta `(user_id, flow_id)`; paginação, geração, cópia, execução e aprovação filtradas por dono. |
| `knowledge_bases`, sources, chunks, vectors, indexes, runs, locks, cleanup | Dono obrigatório; FKs compostas para impedir ligações entre contas. Consulta, indexação, limpeza e credenciais respeitam o mesmo dono. |
| Memória, conversationRunIds, execução de subfluxos | Validar cada referência no contexto da sessão/job; proibir uso de execuções de outra conta. |
| Anexos e arquivos de ferramentas | Anexos SaaS transacionais no PostgreSQL; arquivos de ferramentas em diretórios privados, com validação de caminho. |
| FAISS e bancos vetoriais/record managers externos | Namespaces por usuário/base/geração; verificar conexão/credencial do dono; limpeza nunca alcança outra conta. |
| Impressão e histórico de execuções | Páginas e APIs usam `runs` por usuário. O histórico genérico `resultados` foi removido. |
| Embed settings/sessions/commands/requests | Migrados com ticket, origem, fluxo e dono vinculados; jobs usam a fila comum. Polling, anexos e aprovações não cruzam contas. |
| Webhook de fluxos e MCP | Migrados: Bearer cifrado por conta, validação do dono, rate limit persistido e fila compartilhada. |
| Webhooks WhatsApp/ElevenLabs | Pendentes: endereço/token por usuário, validação antes de ler configurações, eventos deduplicados e entrega pelo worker. |
| ChatGPT/Codex e caches MCP/modelos | Remover singletons globais de conta/conexão; diretórios e caches por usuário, credencial e serviço. |

Esquema das entidades: manter IDs públicos existentes e mover JSON `body` para
`jsonb`, com colunas relacionais para `user_id`, IDs de pais, estado e timestamps.
Índices começam por `user_id` nas listagens. Usar transações para escrita composta,
travas de linha para reivindicação e lease em jobs. Índices únicos e FKs compostas
devem impedir referências cruzadas mesmo quando um caller passar um ID errado.

## Jornadas e infraestrutura ainda pendentes

1. Validar a fila privada e cancelamento de subfluxos entre processos com
   PostgreSQL servidor. Enfileiramento, aprovação transacional, leases, limites e
   propagação de cancelamento já estão implementados. Auditar também
   acesso de conexões configuráveis à rede interna da instalação (HTTP e drivers
   SQL) e capacidade acumulada de vetores antes do beta.
2. Concluir a auditoria do contexto de execuções, webhooks de WhatsApp/ElevenLabs e
   todas as Server Components/APIs do inventário acima. Testar usuários A/B com
   tentativas de acesso cruzado por IDs, arquivos e tokens públicos. A sessão
   ChatGPT persistida já está cifrada; detalhes em [CHATGPT-SESSIONS.md](CHATGPT-SESSIONS.md).
3. Catálogo inicial de Replicate, Higgsfield e MuAPI integrado ao Agente/LLM,
   com chaves cifradas por usuário, submissão única, polling, cancelamento local
   e tentativa remota quando documentada. Nano Banana da Replicate aceita imagens;
   Soul 2 e Nano Banana 2 recebem texto nesta integração. Resultados são anexos
   privados e o identificador externo fica no histórico. Contratos e limites em
   [MEDIA-PROVIDERS.md](MEDIA-PROVIDERS.md). Suítes com respostas controladas;
   geração real em contas pagas ainda não foi validada.
4. Redis/worker implementados para jobs privados e outbox. Validar recuperação
   real entre processos, idempotência dos provedores e shutdown na imagem final.
   Não repetir automaticamente efeitos externos cujo resultado seja incerto.
5. Compose Coolify preparado com app, worker, PostgreSQL, Redis, volumes,
   healthchecks, limites e migrações. Imagem, serviços e persistência/restart
   validados no Docker local. Validar o host Coolify e restauração de backup
   antes de abrir o beta.
6. Validação final: suíte inteira, lint, build, navegador A/B, PostgreSQL servidor,
   Redis/worker, falha e recuperação, restart/volumes, isolamento das rotas públicas
   e privadas. Confirmar configurações reais Resend/Google quando disponíveis.

## Administração do beta no PostgreSQL

Aplicar a fundação, num banco de desenvolvimento configurado em `DATABASE_URL`:

```sh
npm run db:migrate
```

Gerar o segredo de cifragem e manter cópia segura fora do volume:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Criar código forte fora do banco e inserir somente seu SHA-256. Exemplos SQL
(substituir o código e o e-mail pelos valores desejados):

```sql
INSERT INTO invites (id, code_hash, label, max_uses, expires_at)
VALUES (gen_random_uuid(), encode(sha256(convert_to('CODIGO-ALEATORIO-LONGO', 'UTF8')), 'hex'),
        'Turma inicial', 20, now() + interval '30 days');

UPDATE users SET beta_status = 'approved', approved_at = now()
WHERE email = 'pessoa@example.com';

-- Suspensão impede acesso mesmo com sessão previamente emitida.
UPDATE users SET beta_status = 'blocked' WHERE email = 'pessoa@example.com';

SELECT i.label, i.uses, i.max_uses, u.email, r.redeemed_at
FROM invites i
LEFT JOIN invite_redemptions r ON r.invite_id = i.id
LEFT JOIN users u ON u.id = r.user_id;

UPDATE invites SET revoked_at = now() WHERE label = 'Turma inicial';
```

Uma aprovação administrativa não substitui confirmação do e-mail. Códigos são
sensíveis a maiúsculas/minúsculas, com espaços externos removidos no resgate.
Auditoria e contadores são retidos; excluir conta com resgate exige decidir a
política de retenção, em vez de apagar silenciosamente o histórico de uso.

Referências consultadas: [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)
e [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
