# MCP e webhook de fluxos por usuário

A chave criada em **Implantar → Chave de acesso** pertence à conta autenticada.
Ela autoriza listar e executar seus fluxos publicados, consultar seu histórico
privado e responder aprovações. Não é uma chave restrita a um único fluxo.
A chave é mostrada integralmente somente ao gerar; o estado retorna uma máscara.

O valor inclui um prefixo de roteamento do dono e 32 bytes aleatórios. O prefixo
não concede acesso: o servidor valida a chave inteira no contexto da conta.
O segredo fica cifrado no PostgreSQL. Gerar outra chave ou revogá-la invalida
imediatamente novas requisições com o valor anterior, sem afetar outras contas.
Tarefas já aceitas continuam na fila; cancelamento é uma ação separada.
Contas suspensas ou sem e-mail verificado não podem usar a integração.

## HTTP

Envie `Authorization: Bearer SUA_CHAVE` e `Content-Type: application/json`:

- `POST /webhook/flows/{flowId}` com `{"input":"Sua mensagem"}` enfileira o fluxo
  publicado e retorna **HTTP 202**, incluindo `id`, `status` e `queued: true`.
- `GET /webhook/flows/{flowId}?runId={id}` consulta o resultado com o mesmo Bearer.
  O fluxo e a execução precisam pertencer à conta e estar vinculados entre si.

`status: running` com `queued: true` indica espera na fila. Depois de iniciar,
`queued` será falso. `waiting` aguarda aprovação; `completed`, `failed` e
`cancelled` são estados finais. A resposta traz `output`, `error`, `demo` e
`version`. Não há execução longa dentro da requisição HTTP.

Cada POST aceito representa uma nova tarefa. Não repita automaticamente um envio
cujo resultado seja incerto; consulte o histórico da conta antes de reenviar.

## MCP

O endereço continua `/mcp`, com o mesmo Bearer. A implementação usa o SDK MCP
instalado, com transporte Streamable HTTP, respostas JSON e instância sem sessão
compartilhada criada por requisição. Inicialização e negociação de versão,
validação de mensagens e notificações ficam a cargo do SDK. GET retorna 405,
pois o servidor não oferece um canal SSE de notificações.

Ferramentas:

| Nome | Comportamento |
| --- | --- |
| `listar_fluxos` | Publicados da conta autenticada. |
| `executar_fluxo` | Enfileira e retorna o identificador para consulta. |
| `consultar_execucao` | Resultado e etapas de uma execução da conta. |
| `responder_aprovacao` | Aceita `yes`/`no` e enfileira a continuação atomicamente. |

Chamadas a ferramentas com falha retornam `isError`; erros internos não expõem
mensagens de banco ou credenciais. O transporte segue os contratos do SDK para
[inicialização e Streamable HTTP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx).

## Limites e isolamento

HTTP e MCP compartilham 60 requisições por usuário/minuto e 20 solicitações de
execução/continuação por usuário/minuto. Há ainda 180 requisições por IP/minuto,
com a política de proxy confiável já usada pela aplicação. Os contadores ficam
no PostgreSQL e não reiniciam ao trocar chave, processo ou container.

Tarefas entram na mesma fila dos fluxos privados e do chat: uma ativa por usuário,
duas globais e até dez tarefas pendentes/ativas por usuário. Uma aprovação é
persistida junto ao job; duas respostas concorrentes não despacham duas tarefas.
Requisições têm corpo limitado a 300 KB. Cookies não substituem o Bearer nas
rotas públicas. Um Origin presente precisa corresponder a APP_URL; integrações
externas devem usar chamadas de backend, sem publicar o segredo no navegador.

## Verificação

`lib/saas-integrations.test.ts` testa os handlers HTTP reais com banco descartável:
contas A/B, cifragem, chave mascarada, rotação/revogação, prefixo forjado, fluxo
privado, consulta cruzada, aprovação concorrente, cota junto de tarefas privadas,
suspensão, origem e tamanho de corpo. Também conecta o cliente MCP oficial ao
handler e executa o ciclo de inicialização, ferramentas, fila e consulta.

`npm run test:postgres` executa a mesma suíte no PostgreSQL servidor. O teste
Docker inclui MCP A/B, webhook enfileirado, resultado pelo worker e consulta
após recriar os containers.

Nesta etapa passaram 288 testes gerais e 84 cenários no PostgreSQL servidor.
Build aprovado e lint sem erros; permanece o aviso anterior do avatar do chat.
Docker passou com o cliente MCP oficial pela rede, contas separadas e resultado
preservado após recriar containers. A jornada de navegador também passou.

Os webhooks de WhatsApp e ElevenLabs também usam identidade por usuário,
deduplicação e fila; detalhes em [CHANNEL-TENANTS.md](CHANNEL-TENANTS.md). A remoção
dos demais repositórios legados continua pendente em [SAAS-PLAN.md](SAAS-PLAN.md).
