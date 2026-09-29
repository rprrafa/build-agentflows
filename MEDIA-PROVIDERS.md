# Geração de imagens por usuário

Em **Configurações → Geração de imagens**, salve a chave da sua conta na Replicate,
Higgsfield ou MuAPI. Higgsfield recebe a credencial completa, incluindo `ID:segredo`
quando fornecido. Salvar a chave não valida seu saldo nem gera uma cobrança.
As chaves ficam cifradas no PostgreSQL com o proprietário vinculado à cifragem;
não há chave global de ambiente para esses provedores.

No bloco **Agente** ou **LLM**, escolha um dos modelos disponíveis:

| Provedor | Modelo | Entrada | Saída |
| --- | --- | --- | --- |
| Replicate | `google/nano-banana` | Texto e imagens de referência | Imagem |
| Higgsfield | `higgsfield-ai/soul/v2/standard` (Soul 2) | Texto | Imagem |
| MuAPI | `nano-banana-2` | Texto | Imagem |

Este é um catálogo inicial explícito, não um espelho de todos os modelos de cada
plataforma. Soul 2 e Nano Banana 2 nesta integração não recebem imagens de entrada.
Para editar uma imagem, use Nano Banana da Replicate e anexe-a à conversa.
Até cinco referências e 6 MB combinados são enviados como data URIs; os arquivos
continuam privados na aplicação. O provedor selecionado recebe o prompt e as
referências para processar a geração, conforme sua política de retenção.

As instruções, a mensagem da etapa e o texto dos documentos anexados formam a
descrição, limitada a 20 mil caracteres. A memória pode usar todas as mensagens
ou uma janela recente; modelos de imagem não resumem memória, executam ferramentas
ou consultam bases. Prepare a descrição em um bloco de texto anterior quando
precisar dessas capacidades. A aplicação rejeita configurações incompatíveis
antes de executar. Não é necessário conectar ChatGPT para um fluxo que só usa
esses modelos; fluxos mistos exigem as conexões selecionadas em cada bloco.

## Resultados e limites

A execução passa pela mesma fila: uma tarefa ativa por usuário e duas globais,
compartilhadas com fluxos, extração e indexação. O limite da execução privada é
três minutos, incluindo as demais etapas. O worker registra o identificador da
solicitação antes de consultar seu resultado. O chat e o histórico exibem esse
identificador para consulta no painel do provedor.

Imagens prontas são baixadas no servidor, validadas e salvas como anexos privados
do fluxo. A saída é Markdown com `/api/attachments/{id}`, visível no chat e no
histórico com a sessão do dono. Links temporários do provedor não são usados como
armazenamento. Cada arquivo tem até 10 MB, PNG/JPEG/WebP estático e 40 megapixels;
uma resposta aceita até cinco arquivos e 20 MB. O armazenamento compartilha a cota
de 100 MB ou 2.000 anexos por usuário. Remover o fluxo libera os arquivos.

`{{last}}` e `{{nodes.id}}` passam o Markdown aos blocos seguintes. Eles não
transformam automaticamente esse link em uma nova imagem de entrada; para outra
edição, baixe e anexe o resultado à mensagem. No chat incorporado, o download
exige ticket e vínculo com a conversa que gerou a imagem; veja
[EMBED-TENANTS.md](EMBED-TENANTS.md). MCP/webhook de fluxos retornam o Markdown;
baixar a URL privada exige a sessão do dono. Os canais WhatsApp/ElevenLabs ainda
não recebem acesso aos anexos privados.

Não há repetição automática de submissões após resposta incerta. Cancelar
interrompe o acompanhamento local e tenta cancelar na Replicate/Higgsfield.
Higgsfield só aceita cancelamento enquanto aguarda na fila. MuAPI não documenta
cancelamento público para esses endpoints. Em caso de interrupção, a tarefa
externa pode continuar e ser cobrada: consulte o identificador no painel antes
de repetir. Uma queda do worker segue a política da fila, sem repetir efeitos
externos. Gravações após perda da autorização do job são recusadas.

Chamadas autenticadas usam origens fixas e não seguem redirecionamentos. URLs de
resultado precisam ser HTTPS; o download bloqueia endereços privados, fixa a
resolução DNS, limita bytes e verifica redirecionamentos. A chave Replicate só
acompanha downloads de `replicate.delivery` e seus subdomínios. As outras chaves
nunca são encaminhadas a URLs de resultado.

## Validação e contratos

`lib/media-provider.test.ts` usa respostas controladas para os três contratos:
autenticação, envio, polling, imagem de referência, falhas, cancelamento, respostas
inválidas, limites e submissão única. `lib/saas-media.test.ts` integra o adaptador
com sessão, credencial cifrada, persistência, download HTTP por proprietário e
recusa de worker sem autorização. A suíte roda em PGlite e PostgreSQL servidor.
`npm run test:docker` verifica também credenciais e anexos privados após recriar
os containers. Não foram usadas chaves reais de serviços pagos; disponibilidade,
saldo e geração real nessas contas permanecem sem confirmação.

Contratos oficiais consultados em 29/09/2026:

- [Replicate HTTP API](https://replicate.com/docs/reference/http), [Nano Banana](https://replicate.com/google/nano-banana/api/schema), [arquivos de entrada](https://replicate.com/docs/topics/predictions/input-files) e [saídas](https://replicate.com/docs/topics/predictions/output-files).
- [Higgsfield Soul 2](https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard/api-reference) e [ciclo da solicitação](https://docs.higgsfield.ai/docs/concepts/requests).
- [MuAPI HTTP API](https://muapi.ai/docs/api-reference) e [OpenAPI](https://api.muapi.ai/openapi.json).
