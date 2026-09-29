# Chat no site — contrato v1

O usuário conversa normalmente. Configuração técnica fica em **Implantar → Chat no site → Instalação e opções para desenvolvedores**. Nenhuma ferramenta precisa ser habilitada manualmente em cada agente.

## Instalação

1. Salve o fluxo no editor (o salvamento já publica ou atualiza a v1). Cadastre as origens exatas autorizadas (por exemplo `https://stage.example.com`) e salve o chat; a ativação é automática. Sem domínios no fluxo, localhost e 127.0.0.1 são aceitos em qualquer porta, sujeitos à lista global.
2. A chave do servidor é criada internamente ao salvar ou abrir o preview. Para provisionar o backend de uma aplicação externa, um administrador pode gerar uma nova chave pela API autenticada: `POST /api/flows/ID_DO_FLUXO/embed`, com corpo `{}`. A resposta contém `key`; essa operação substitui a chave anterior e invalida os tickets existentes. Guarde-a somente no backend da aplicação alvo, nunca no script público.
3. Implemente `/api/chat-access` na aplicação alvo. Autentique o usuário com a sessão já existente e confira se ele pode usar este fluxo. Não aceite `subject`, `flowId` ou `origin` arbitrários do navegador.
4. Esse endpoint chama, de servidor para servidor:

```http
POST https://flows.example.com/api/embed/token
Authorization: Bearer CHAVE_DO_SERVIDOR
Content-Type: application/json

{"flowId":"ID_DO_FLUXO","subject":"ID_INTERNO_DO_USUARIO","origin":"https://stage.example.com"}
```

Retorne ao navegador apenas `{ "token": "...", "expiresAt": 123 }`, com `Cache-Control: no-store`. Os tickets expiram em dez minutos; o widget chama `getToken` novamente quando necessário. A chave é restrita a um fluxo. Trocar a chave ou desativar o chat revoga os tickets existentes. Autenticação e permissões da aplicação alvo continuam sendo responsabilidade do seu backend.

5. Instale uma vez no layout principal, fora da árvore de componentes substituída nas trocas de rota:

```html
<script src="https://flows.example.com/embed.js"></script>
<script>
  const chat = Agentflows.mount({
    url: 'https://flows.example.com',
    flowId: 'ID_DO_FLUXO',
    appVersion: 'COMMIT_OU_VERSAO',
    getToken: async () => {
      const response = await fetch('/api/chat-access', { method: 'POST' });
      if (!response.ok) throw new Error('Acesso não autorizado');
      return response.json();
    }
  });
</script>
```

Em React, monte no efeito do layout e chame `chat.destroy()` no cleanup. Destrua o widget no logout ou na troca de usuário. Se houver CSP na aplicação alvo, autorize o domínio do Build Agentflows em `script-src` e `frame-src`. A API do widget é chamada pelo iframe na origem do Build Agentflows; o host não recebe cookies administrativos.

## Sessões e execução

A referência da conversa, rascunho e estado aberto/fechado ficam em `sessionStorage` da página hospedeira, separados por origem do serviço e fluxo. As mensagens, aprovações, tarefas e comandos ficam no SQLite do Build Agentflows. O ID da conversa não concede acesso: cada chamada valida o ticket e seu usuário, origem e fluxo. Recarregar restaura o chat; mensagens são identificadas para evitar tarefas duplicadas em novas tentativas de envio.

A API aceita a mensagem e retorna sem aguardar a IA. Um worker local consulta a fila persistida. O widget sincroniza o snapshot por polling curto; não mantém uma requisição de IA aberta durante toda a tarefa. A execução usa o último fluxo salvo (v1), capturado ao iniciar. Salvar também publica ou atualiza a v1 para as integrações configuradas. Novos salvamentos atualizam as próximas execuções, sem alterar tarefas em andamento.

Uma aprovação humana libera o worker e mantém o checkpoint. Se o servidor reiniciar no meio de uma operação, a tarefa pede revisão antes de repetir a etapa; não há replay automático de efeitos externos. São permitidas até duas retomadas confirmadas por tarefa. O tempo ativo acumulado e o limite de comandos não são zerados ao retomar. Cancelar bloqueia novas etapas, solicita interrupção do modelo e invalida comandos pendentes; efeitos já realizados não são desfeitos.

**Modelo de implantação:** processo Node persistente, um único processo/instância por banco SQLite e volume persistente em `DATA_DIR`. Não usar este worker embutido em funções serverless ou múltiplas réplicas. Uma fila distribuída com leases seria necessária para essa evolução. Provedores e ferramentas ainda podem ter limites menores por chamada; o orçamento total não elimina esses limites. Não há integração GitHub ou política de retry de deploy nesta entrega do chat.

“Nova conversa” fica disponível após concluir/cancelar a tarefa ativa. A conversa anterior permanece no histórico administrativo do fluxo. Uma nova sessão não move tarefas da anterior.

## Ponte e capacidades

Protocolo entre host e iframe: `channel: "agentflows"`, `version: 1`, com validação de `origin` e `source`. O script anuncia capacidades ao conectar. O runtime oferece as capacidades como ferramentas somente em blocos **Agente** de sessões embed conectadas. Chamadas comuns do editor, webhook e API continuam sem ferramentas da página.

Cada comando possui `id`, `sessionId`, `runId`, `name`, `args` e `expiresAt`. Estados: `pending → delivered → completed | failed`; também `expired` e `cancelled`. O recebimento (`claim`) acontece uma única vez antes da execução. Resultado deve chegar em até dois minutos e pertence à mesma sessão/execução. Recarregar após o recebimento não repete o comando: retorna resultado desconhecido. Eventos não autorizam JavaScript arbitrário.

| Ação padrão | Argumentos | Resultado |
|---|---|---|
| `page.getContext` | `{}` | Origem/caminho, título, viewport e versão |
| `page.inspect` | `{}` | Até 60 controles visíveis com seletor, papel e rótulo |
| `page.selectElement` | `{}` | Elemento indicado pela pessoa; Escape cancela |
| `page.highlight` | `{selector}` | Confirmação de destaque temporário |
| `page.scroll` | `{selector}` ou `{top}` | Posição de rolagem atingida |
| `page.click` | `{selector}` | `{dispatched:true,effectConfirmed:false}` após confirmação humana |
| `page.navigate` | `{url}` | Solicitação de navegação na mesma origem, após confirmação; mudança efetiva é contexto subsequente |
| `page.requestScreenshot` | `{}` | Referência de anexo e contexto, após autorização do navegador |

Essas ações já vêm implementadas no script. `getDisplayMedia` só é anunciado quando disponível; requer HTTPS (ou localhost), gesto real do usuário e seleção de superfície. Captura não é silenciosa. A imagem chega ao modelo em uma análise complementar; ele precisa suportar imagens. Upload manual é alternativa. Um print pode conter dados privados: a pessoa é orientada antes de compartilhar. Não existe redação automática de pixels.

Marque áreas privadas com `data-agentflows-private`; elas ficam excluídas de inspeção/seleção/cliques. Prefira IDs estáveis ou `data-agentflows-id="nome"`. A inspeção não lê valores dos inputs, mas rótulos/textos também podem conter informação sensível: marque os containers correspondentes como privados. Prints nativos continuam capturando o que a pessoa escolher compartilhar. Iframes externos e shadow roots internos da aplicação não são atravessados.

Clique disparado não prova sucesso da operação. Não repita automaticamente cliques cujo resultado é desconhecido. Ações mutáveis pedem confirmação da pessoa. Cliques sintéticos não substituem gestos reais exigidos por APIs do navegador.

## Aplicação → conversa

```js
chat.emit('page.contextChanged', { screen: 'clientes', filter: 'ativos' });
chat.emit('page.errorReported', {
  message: 'Não foi possível carregar a próxima página',
  code: 'CUSTOMER_PAGE_FAILED'
});
chat.shareAttachment(file); // File/Blob de até 10 MB; usuário envia junto da mensagem
chat.open();
```

Mudanças de URL são detectadas pelo script. Contexto é limitado e disponibilizado na próxima análise; receber um evento não inicia uma tarefa nem interrompe o modelo automaticamente. Relatos não substituem instruções do usuário. Não envie tokens, senhas, valores de formulário ou logs brutos contendo dados pessoais. Filtre os dados no handler da aplicação. O widget não intercepta todo o console nem monitora tráfego de rede.

## Ações customizadas (opcionais)

```js
const chat = Agentflows.mount({
  url: 'https://flows.example.com', flowId: 'ID_DO_FLUXO', getToken,
  actions: {
    'app.openRecord': {
      description: 'Abrir cadastro de cliente pelo identificador',
      schema: {
        type: 'object', properties: { id: { type: 'string' } },
        required: ['id'], additionalProperties: false
      },
      handle: async ({ id }, { signal }) => {
        // Valide argumentos, autorização e efeito aqui. Respeite signal.aborted.
        await abrirCliente(id, { signal });
        return { opened: true };
      }
    }
  }
});
```

Use namespace `app.` e nomes curtos. O handler deve validar os argumentos e retornar dados serializáveis em JSON de até 16 mil caracteres. Erros devem ser lançados como `Error`. A descrição será apresentada à pessoa antes de autorizar uma ação customizada. O sinal de cancelamento é cooperativo; não promete desfazer algo já realizado. O schema orienta o modelo, mas não substitui validação no handler.

## Verificação local

Em **Implantar → Chat no site**, abra **Testar em uma página**. Em localhost, a prévia funciona com a lista de domínios vazia e prepara a chave internamente. Em outra origem, cadastre o endereço dessa instalação. O script de instalação também pode ser copiado na página de preview. A página de preview mostra o nome do fluxo e o botão circular para abrir o chat. As execuções usam o último fluxo salvo (v1) e o provedor real configurado; não simulam respostas de IA. Em Chat no Site, escolha a visualização detalhada, com atividades e progresso, ou simplificada, com a resposta final. Aprovações e erros permanecem visíveis nos dois modos.

Testes automatizados: `node --import ./scripts/gancho-ts.mjs --test lib/embed.test.ts lib/flow-runtime.test.ts`.
