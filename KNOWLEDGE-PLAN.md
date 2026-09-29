# Base de Conhecimento — auditoria da versão 0.11.0

Objetivo integral: jornada Document Store do Flowise, 20 extratores em ordem alfabética, revisão e organização dos fragmentos, Embeddings / Vector Store / Record Manager, consulta no Agente e controle de retorno de referências, UI na tela inicial, validação visual e funcional, versão, commit e push.

Referência inspecionada: `/Users/rafael/Desktop/projetos/Flowise-main/packages/ui/src/views/docstore/` (lista, prévia/processamento, fragmentos, configuração, indexação, histórico e consulta) e respectivos document loaders. Implementação própria com o padrão visual existente.

## Entregas verificadas

- [x] Catálogo dos 20 extratores, extração real e contratos testados.
- [x] Persistência, credenciais cifradas, fontes, fragmentos editáveis, reprocessamento e exclusão.
- [x] Embeddings OpenAI/compatível e Ollama; vetores locais persistidos e Qdrant; Record Manager SQLite/sem controle, deduplicação e limpeza.
- [x] Indexação com progresso/histórico, recuperação de erros e teste de busca.
- [x] Seleção da base e controle de referências no Agente, execução dos dois motores com respostas controladas nos testes.
- [x] Interface completa na biblioteca/tela inicial; celular e temas claro/escuro.
- [x] Testes de contratos, integração, ciclo completo, autenticação; lint, build e verificadores da suíte.
- [x] Documentação e nova versão. A publicação do código é registrada no histórico Git.

Bibliotecas: parsers de documentos (officeparser, unpdf, csv-parse, cheerio), text splitters LangChain e SDK S3. O extrator customizado executa JavaScript no E2B já usado pelo app, sem acesso ao processo do servidor.

## Evidências

- `lib/knowledge-catalog.ts`: exatamente os 20 nomes pedidos; teste compara a lista inteira na ordem alfabética.
- `lib/knowledge-loaders.ts` e `scripts/fixtures/knowledge`: parsers reais de texto, CSV, JSON, PDF e Office; conectores cloud/S3/E2B com contratos exercitados em `lib/knowledge.test.ts`, incluindo JSONL do Spider.
- `lib/knowledge-store.ts` e `knowledge-index.ts`: credenciais cifradas, isolamento entre bases, índice persistente, troca após sucesso, registros de reaproveitamento, busca, reindexação e exclusão; cenários de falha e concorrência testados.
- `lib/knowledge-agent.ts`, `flow-runtime.ts` e `components/KnowledgeAgentFields.tsx`: contexto entregue aos motores e referências opcionais, grafo persistido e validação na gravação.
- Navegador local, build standalone, dados temporários: criação, extração Plain Text e upload PDF real, revisão, configuração completa, indexação, consulta, histórico, edição e reindexação. Seleção e referências no Agente; telas de 1440 px e 390 px, claro/escuro, sem erro de JavaScript e sem overflow horizontal após o ajuste do menu.
- HTTP real no standalone: health/status 200; rotas knowledge sem sessão retornam 401; API de setup antiga continua 410 conforme contrato preexistente.
- `npm run lint`, `npx tsc --noEmit`, `npm test` (172 testes), `npm run build`, `git diff --check`, verificação de jargão e paleta: aprovados. `npm audit --omit=dev`: zero vulnerabilidades.
- `verificar-padrao.sh`: seção build-agentflows aprovada; resultado global continua com divergências preexistentes em outros apps (agente-kanban, entrevista-ia e videos-campanha, entre as reportadas). O proxy do Build Agentflows não foi alterado; sua diferença de embed, já existente no HEAD anterior, foi documentada na lista de exceções.
- Os serviços pagos não foram chamados com contas reais. Sua configuração e seus limites ficam explícitos em `KNOWLEDGE.md`.
