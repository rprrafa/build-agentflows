# Recursos da conexão ChatGPT

A instalação usa `@openai/codex` 0.155.1 via App Server e login ChatGPT. Os recursos da interface ChatGPT não são automaticamente ferramentas deste fluxo.

- **Pesquisa web:** opção no bloco Agente; configura `web_search: live` exclusivamente no thread daquela execução. Desligada por padrão e indisponível nessa opção para OpenRouter. Sujeita às permissões e limites da conta. O terminal e o acesso ao sistema continuam desabilitados.
- **Leitura de imagens:** imagens anexadas ou capturas do embed são enviadas somente quando o modelo informa suporte a entrada de imagem. Não equivale a gerar imagens.
- **Geração de imagens:** não há integração de geração pela assinatura nesta versão. Pode ser adicionada como ferramenta com um provedor e autenticação próprios.
- **Execução de código:** já existe a ferramenta Code Interpreter by E2B no catálogo; exige credencial E2B. Esta conexão não expõe o Code Interpreter hospedado da API OpenAI nem herda o ambiente do ChatGPT.

Referências oficiais consultadas em 24/09/2026:

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Configuração de ferramentas e web_search](https://learn.chatgpt.com/docs/config-file/config-reference)

O protocolo de configuração foi verificado com testes locais; não foi executada uma pesquisa real usando créditos ou a assinatura do usuário.
