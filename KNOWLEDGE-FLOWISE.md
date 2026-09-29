# Base de Conhecimento — comparação com Flowise

Revisão da versão 0.16.0, em 25/09/2026. Referência: código local de `Flowise-main/packages/components/nodes` (documentloaders, embeddings, vectorstores e recordmanager) e catálogo `packages/components/models.json`.

A jornada principal está contemplada: extrair documentos, revisar e dividir o texto, gerar embeddings, indexar, evitar processamento repetido, consultar e entregar os trechos ao Agente. Os campos avançados não têm paridade integral com o Flowise.

## Etapas

| Etapa | Disponível no projeto | Diferenças relevantes em relação ao Flowise |
| --- | --- | --- |
| Fontes | 20 extratores com os logos da referência, campos por serviço, upload, credenciais cifradas, extração, metadados e revisão dos trechos. | Catálogo limitado às 20 fontes selecionadas. PDF digitalizado exige OCR prévio. Custom Document Loader executa no E2B. |
| Divisão | Divisores recursivo e por caracteres, tamanho, sobreposição e separador; edição de conteúdo/metadados dos trechos. | Não inclui todos os divisores especializados, por tokens e semânticos do Flowise. |
| Embeddings | Gemini, OpenAI, VoyageAI e Ollama, com logos e listas de modelos. Credenciais compartilhadas no menu Credenciais. Dimensões automáticas ou reduzidas nos modelos OpenAI text-embedding-3, transporte float/base64 para OpenAI, URL configurável, credencial, lote, timeout e remoção opcional de quebras de linha. | Não há cabeçalhos arbitrários, task type manual ou ajustes de GPU/threads do Ollama. Recuperação usa documento/query conforme o provedor. |
| Vector Store | Os 11 serviços abaixo recebem vetores reais e participam da consulta e exclusão. Top K e similaridade mínima salvos na base e herdados pelo teste/Agente; filtro de metadados Faiss/Postgres; ranking cosseno, euclidiano e produto interno no Postgres. | Não expõe MMR, busca híbrida, reranking, operadores arbitrários no filtro nem todos os ajustes de índices de cada serviço. |
| Record Manager | SQLite e Postgres, com logos, hash do conteúdo/configuração, reaproveitamento de embeddings e limpeza da versão anterior. Postgres permite credencial reutilizável, host/banco/porta/SSL, timeouts, tabela e namespace. | Limpeza nenhuma, incremental ou completa (padrão), com identificação automática da fonte ou chave de metadados na incremental. SQLite usa o banco persistente do app. Exclusão explícita de fonte/base sempre remove seus dados. |
| Conhecimento no Agente e LLM | Cards de múltiplas bases, descrição de quando consultar e referências por base. Cada base é uma ferramenta disponível para o modelo, com ChatGPT e OpenRouter, e suas chamadas aparecem na execução. | Até 10 bases por bloco; modelos devem suportar ferramentas. A base precisa estar indexada e pronta no momento da consulta. |

## Modelos e dimensões

Esses valores ficam no catálogo interno; o usuário escolhe o modelo. A resposta do serviço é validada para impedir mistura de tamanhos incompatíveis.

| Provedor | Modelo | Dimensões |
| --- | --- | ---: |
| Google Gemini | gemini-embedding-001, gemini-embedding-2 | 3072 |
| OpenAI | text-embedding-3-small | 1536 |
| OpenAI | text-embedding-3-large | 3072 |
| OpenAI | text-embedding-ada-002 | 1536 |
| VoyageAI | voyage-4, voyage-4-large, voyage-4-lite, voyage-code-4, voyage-3.5, voyage-3.5-lite, voyage-code-3, voyage-finance-2, voyage-law-2 | 1024 |
| Ollama | nomic-embed-text | 768 |
| Ollama | mxbai-embed-large, bge-m3 | 1024 |
| Ollama | all-minilm | 384 |

Os valores da tabela são os tamanhos padrão. OpenAI text-embedding-3 aceita dimensões reduzidas na interface; outros provedores mantêm o tamanho do catálogo.

O modelo precisa estar disponível na conta ou instalado no servidor Ollama. Configurações anteriores com modelo personalizado continuam preservadas. As opções legadas de armazenamento local e Record Manager desativado continuam legíveis, mas não aparecem como novos provedores.

Referências dos protocolos: [OpenAI](https://developers.openai.com/api/docs/guides/embeddings), [Gemini](https://ai.google.dev/gemini-api/docs/embeddings), [VoyageAI](https://docs.voyageai.com/docs/embeddings) e [Ollama](https://docs.ollama.com/capabilities/embeddings). Gemini 001 usa `RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY`; Gemini 2 usa os prefixos de tarefa próprios do modelo. Voyage usa `input_type`.

## Bancos vetoriais

| Opção | Implementação e preparação necessária |
| --- | --- |
| Chroma | API v2; tenant e database configuráveis. Cria coleção com cosseno e fornece embeddings próprios. |
| Elasticsearch | REST com `dense_vector`, índice por versão e k-NN. API key ou usuário/senha. Requer uma versão com suporte às APIs utilizadas e permissão de criação de índices. |
| Faiss | Índice nativo `IndexFlatIP` com vetores normalizados, persistido em `DATA_DIR/knowledge-faiss`. É o padrão para novas bases, sem serviço externo. |
| MongoDB Atlas | Driver MongoDB, coleção por versão e Atlas Vector Search. Aguarda o índice ficar consultável. Exige Atlas Vector Search e permissão de criar índices de busca. MongoDB sem esse recurso não basta. |
| Pinecone | API do host de um índice existente, com namespace por versão. Confere dimensões e aguarda visibilidade da gravação. O índice deve usar cosseno e o tamanho do modelo escolhido. |
| Postgres | Driver `pg` e extensão pgvector, tabela por versão, prefixo/schema/coluna configuráveis, gravação em lotes e busca `<=>`, `<->` ou `<#>` com filtro JSONB parametrizado. Conexão por credencial e campos ou string cifrada. Extensão instalada e permissão de criar tabelas necessárias. |
| Qdrant | REST, coleção com cosseno, gravação/consulta/exclusão; mantém os nomes e IDs das bases criadas anteriormente. |
| Weaviate | REST para schema/objetos e GraphQL `nearVector`. Vetores externos, sem vectorizer automático. Valida falhas individuais no lote. |
| Supabase | PostgREST e função RPC com pgvector. A interface fornece SQL para criar tabela e função conforme o modelo; execute no SQL Editor. Requer chave com leitura/escrita e acesso à função. Ao mudar as dimensões, prepare outra tabela/função compatível. RLS fica habilitado; a aplicação usa filtro de base/versão nas consultas e exclusões. |
| SingleStore | Driver MySQL, `JSON_ARRAY_PACK` e `DOT_PRODUCT` com vetores normalizados. Requer banco existente e permissão para criar tabelas; não basta um servidor MySQL comum. |
| OpenSearch | REST, índice k-NN e mapeamento vetorial. Requer recurso k-NN habilitado e autenticação compatível com API key ou usuário/senha; assinatura AWS IAM não está implementada. |

Coleções/tabelas/namespaces são gerados pelo app para isolar bases e versões, em vez de escrever em coleções escolhidas livremente. Após a publicação, a versão anterior é removida. Falhas de limpeza permanecem registradas para nova tentativa. As conexões usadas por cada geração ficam cifradas, permitindo limpar o destino antigo mesmo depois de trocar a configuração.

Os trechos e vetores também permanecem no SQLite do app para controle de versões, metadados e reaproveitamento. Portanto, configurar um banco remoto **não elimina a necessidade de persistir `DATA_DIR`**. A ordenação usa a estratégia escolhida (Postgres) ou cosseno (demais serviços). O limiar e a pontuação exibida sempre usam similaridade de cosseno dos vetores armazenados.

## Limpeza do Record Manager

- **Nenhuma:** preserva conteúdo anterior e adiciona as versões atuais; reindexar os mesmos trechos não os duplica. Trechos antigos continuam disponíveis para consulta.
- **Incremental:** substitui os trechos das fontes presentes na indexação, preservando as ausentes. Por padrão, usa o ID da fonte cadastrada. Para distinguir documentos de um mesmo extrator (por exemplo, páginas de um site), informe em Opções avançadas uma chave dos metadados como `source`. Todos os trechos atuais e anteriores precisam conter um texto ou número nessa chave; valores ausentes impedem a indexação sem publicar dados parciais.
- **Completa (padrão):** sincroniza com todos os trechos atuais, removendo conteúdo ausente e versões anteriores. Também permite publicar um índice vazio depois de remover todos os trechos.

A retenção é aplicada ao conteúdo da nova geração. Os arquivos/tabelas da geração anterior continuam sendo removidos após a publicação, em qualquer modo. Se o modelo ou preparação dos embeddings mudar, o conteúdo retido recebe novos embeddings compatíveis.

Excluir uma fonte ou base explicitamente sempre remove seus dados, independentemente do modo de limpeza. A exclusão da base exige digitar seu nome na interface. O histórico persistente de gerações é consultado mesmo após trocar de banco vetorial: Faiss → Postgres → excluir remove as pastas Faiss ainda pendentes e as tabelas Postgres. Se uma limpeza falhar, a base e as referências permanecem para repetir a exclusão. O volume compartilhado `DATA_DIR` e os dados das demais bases são preservados.

## Validação

- Suíte automatizada: extração, persistência, credenciais, publicação, reindexação, busca, exclusão e execução do Agente, além dos contratos de embeddings e bancos vetoriais.
- Modos de limpeza: indexação e consulta com Faiss real e Record Managers SQLite/Postgres; retenção, atualização, repetição sem duplicatas, chave de metadados, troca de modelo e recuperação de falha. Migração Faiss → Postgres e exclusão testadas antes/depois de indexar, inclusive falha de permissão na pasta antiga e nova tentativa de exclusão, preservando outra base.
- Faiss nativo: gravação em disco, leitura, busca e exclusão de IDs; carregamento e busca também verificados na imagem Docker Alpine standalone.
- Postgres + pgvector e Chroma: serviços reais descartáveis, com indexação, consulta, reaproveitamento no Record Manager Postgres, remoção da geração anterior e exclusão de fonte/base.
- SQL de preparação do Supabase: executado no Postgres com pgvector, incluindo busca e isolamento por filtro.
- MongoDB Atlas e SingleStore: contratos dos drivers com substitutos de teste, cobrindo fechamento de conexões, falhas, indexação, busca e exclusão.
- Demais serviços: testes de contrato HTTP. Não foram usadas contas reais de Gemini, OpenAI, VoyageAI, Pinecone, Supabase, Atlas ou demais serviços externos nesta validação. Não equivale a homologação em todas as versões e configurações desses serviços.
- Navegador: seleção, busca, logos, modelos, salvamento e layout em desktop/celular. Compilação de produção, TypeScript e lint.

Para repetir a integração, forneça um **Postgres descartável** em `KNOWLEDGE_TEST_POSTGRES`; opcionalmente um Chroma em `KNOWLEDGE_TEST_CHROMA`, e execute:

```sh
node --import ./scripts/gancho-ts.mjs scripts/verify-knowledge-services.mjs
```

O script cria e remove tabelas de teste com prefixo `knowledge_test_`. Não use banco de produção. Os testes unitários usam `npm test`.

Os 37 logos foram copiados do Flowise local, com atribuição e licença em `public/knowledge-icons/`.

## Auditoria dos campos das imagens do Flowise

| Referência | Refinamento no app | Diferença intencional / limite |
| --- | --- | --- |
| Faiss — Base Path / Top K | Armazenamento automático, sem campo de caminho na interface; Top K salvo na base e aplicado no teste/Agente. | Caminho administrado automaticamente para evitar sobrescrita; não carrega índices externos. |
| OpenAI — credencial, modelo, Strip New Lines, Batch Size, Timeout, Base Path | Disponíveis; URL do serviço corresponde à conexão de embedding. | Credencial compartilhada e cifrada. |
| OpenAI — Dimensions / Encoding Format | Dimensões reduzidas para text-embedding-3; float/base64 na API. | Demais modelos/provedores mantêm dimensões do catálogo. |
| OpenAI — Base Options | Não adicionado. | Cabeçalhos arbitrários exigem um contrato próprio para guardar segredos e impedir sobreposição da autenticação. |
| Postgres — credencial, host, database, port, SSL | Campos separados, credencial compartilhada e timeouts; URL cifrada continua compatível. | SSL valida certificados. |
| Postgres — Table Name / Content Column / Upsert Batch Size | Prefixo de tabela isolado por base/versão, coluna de conteúdo e tamanho do lote funcionais. | Não escreve em tabelas preexistentes do Flowise; a coluna configurável também funciona em nosso driver. |
| Postgres — Distance Strategy / Top K / Metadata Filter | Três rankings, Top K herdável e filtro por igualdade antes do limite. | Sem operadores SQL/JSON arbitrários ou interpolação de variáveis; similaridade mínima continua sendo cosseno. |
| Postgres — Additional Configuration | Timeouts e SSL expostos por campos validados. | Não aceita um objeto TypeORM arbitrário; o app usa o driver pg. |
| Postgres — File Upload | Upload permanece na etapa Documentos, com revisão e publicação. | Arquivos enviados no chat não entram automaticamente na base compartilhada. |
| Record Manager — Cleanup / SourceId Key | Nenhuma, incremental e completa; identificação automática ou chave de metadados na incremental. | Padrão completa, preservando bases existentes. Exclusão explícita sempre purga dados; a indexação considera todas as fontes revisadas da base. |

Protocolo das opções OpenAI conferido na [referência oficial de embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create) e no [guia de dimensões](https://developers.openai.com/api/docs/guides/embeddings). Os testes HTTP usam respostas controladas, sem consumo de créditos de provedores externos.

Regressão adicional com Postgres descartável:

```sh
KNOWLEDGE_TEST_POSTGRES=postgresql://... node --import ./scripts/gancho-ts.mjs --test lib/knowledge-refinements.test.ts
```
