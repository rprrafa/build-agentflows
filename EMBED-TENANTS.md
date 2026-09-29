# Chat incorporado por usuário

O chat usa PostgreSQL e a fila compartilhada com as execuções privadas. Não há
worker exclusivo nem tabelas SQLite para essa integração. A migração Drizzle
`0001_private-embed.sql` adiciona configurações, sessões, pedidos e comandos;
as relações incluem `user_id`, fluxo e sessão para recusar vínculos cruzados.

## Autorização

As configurações e a rotação da chave em `/api/flows/{id}/embed`, a política de
sites em `/api/security/embed` e a página de preview exigem a sessão do dono.
A chave de integração fica cifrada na configuração dessa conta. O backend do
site integrado usa essa chave para emitir tickets em `/api/embed/token`;
o navegador recebe somente o ticket assinado, com validade de dez minutos.

O proprietário é resolvido a partir do fluxo persistido, antes de abrir o contexto
da conta e validar a credencial. Não há parâmetro de usuário para escolher um
tenant. IDs públicos ambíguos são recusados. Contas não verificadas ou suspensas
não atendem a integração. Trocar a chave, desativar o chat ou despublicar o fluxo
invalida seus tickets; o worker revalida a conversa antes de começar o fluxo.

Cada conversa fica vinculada ao fluxo, visitante, origem, geração da chave e aba.
Um ticket de outro visitante não permite consultar, responder comandos, cancelar
ou baixar anexos dessa conversa. Uploads e imagens geradas usam o armazenamento
privado da conta; downloads públicos exigem o ticket e o vínculo com a conversa.
Uma imagem gerada aparece com um botão de download, sem publicar uma URL aberta.

A lista de sites da conta restringe a lista do fluxo. Lista vazia permite apenas
loopback para desenvolvimento. A prévia autenticada usa `APP_URL` e ticket próprio
para essa origem; não precisa acrescentar a origem administrativa aos sites
públicos. A política `frame-ancestors` permite os sites configurados e a própria
aplicação. Cabeçalhos Host/Forwarded não escolhem a origem da prévia.

## Fila, comandos e limites

- Todas as conversas e fluxos do mesmo usuário compartilham uma vaga ativa,
  duas vagas globais e backlog de dez tarefas por usuário/mil globais.
- Mensagem, vínculo de idempotência, execução e job são gravados na mesma
  transação. Repetir o identificador da mensagem devolve a execução existente;
  uma conversa só mantém uma tarefa ativa ou aguardando aprovação.
- Sessões duram até um dia, com até 500 sessões por conta, 100 mensagens por
  sessão e 50 anexos enviados por conversa. A cota de arquivos continua por usuário.
- O tempo máximo configurável é quinze minutos, compatível com o worker; o tempo
  consumido é mantido entre aprovações. Não há retomada automática de efeitos
  externos após queda do processo. Revise o resultado antes de enviar outra tarefa.
- Uma ação de página passa por `pending → delivered → completed/failed`. Claim e
  resposta são atômicos; repetições são recusadas. Há uma ação pendente por execução,
  prazo de dois minutos por comando e até trinta comandos por tarefa.
- Cancelamento e recuperação encerram os comandos pendentes. A vaga do worker
  continua ocupada até ele confirmar o encerramento ou a autorização expirar.
- Limites persistidos: 180 requisições por IP/minuto, 600 autenticadas por dono/minuto,
  60 emissões de ticket/minuto e 20 mensagens, uploads ou downloads/minuto por dono.

## Verificação

`lib/saas-embed.test.ts` cobre endpoints reais, contas/visitantes separados,
assinatura e revogação, origens, chave privada, fila, idempotência, concorrência,
aprovação, cancelamento, captura de tela, imagens e limites. A mesma suíte roda
em PGlite e PostgreSQL servidor.

Validação desta etapa: 281 testes gerais e 76 cenários no PostgreSQL passaram;
build concluído e lint sem erros, com o aviso preexistente do avatar. Docker e
navegador passaram com os cenários abaixo.

O teste Docker inclui ticket público, envio pelo worker e histórico preservado
após recriar containers. Opcionalmente, execute também a jornada do navegador:

```sh
PLAYWRIGHT_MODULE=/caminho/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/caminho/chrome \
DOCKER_BIN=/caminho/docker npm run test:docker
```

O módulo Playwright deve estar instalado separadamente; sem um executável indicado,
usa seu Chromium instalado. O teste abre somente uma porta temporária em loopback,
usa duas contas descartáveis e remove seus containers/volumes ao terminar. A
jornada verifica configurações A/B, preview em iframe, envio pela fila, recarga,
desktop e celular, sem serviços pagos. Capturas ficam em
`/tmp/agentflows-embed-desktop.png` e `/tmp/agentflows-embed-mobile.png`.

Webhooks e MCP públicos, a cifragem da sessão ChatGPT e os demais repositórios
legados ainda têm pendências em `SAAS-PLAN.md`; esta migração não encerra a
validação da aplicação inteira para abertura do beta.
