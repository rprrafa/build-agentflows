# Sessão ChatGPT cifrada por usuário

A migração Drizzle `0002_encrypted-chatgpt-session.sql` cria `chatgpt_sessions`,
com uma linha por usuário. O conteúdo inclui o cache nativo de autenticação,
metadados da conta, catálogo de modelos e estado do login. Tudo fica cifrado
com AES-256-GCM, usando `CHAVE_MESTRA` e dados autenticados que incluem o dono.
Copiar o ciphertext para outra conta não permite decifrá-lo.

O login continua por dispositivo no processo oficial `@openai/codex` instalado.
A aplicação não implementa endpoints OAuth alternativos nem solicita tokens ao
navegador. O navegador recebe apenas o código temporário de login e o estado da
conexão. [A documentação oficial](https://learn.chatgpt.com/docs/auth#login-caching)
explica que o armazenamento nativo em arquivo usa `CODEX_HOME/auth.json`.

## Ciclo do processo

1. O dono vem da sessão autenticada ou do job. Abrir uma conexão nativa exige
   contexto de usuário ativo; não há leitura das credenciais Codex do host.
2. Uma atualização atômica no PostgreSQL reserva a sessão por até 60 segundos.
   App e workers compartilham essa trava. Antes de abrir o processo, a aquisição
   pode esperar até dois segundos por uma consulta de metadados em andamento;
   nenhuma chamada ao provedor é repetida nesse intervalo.
3. O cache é decifrado em um diretório temporário aleatório, com permissão 0700;
   `auth.json` é restaurado com 0600. HOME, CODEX_HOME e o diretório de trabalho
   pertencem exclusivamente a esse processo. O ambiente usa uma lista permitida
   e não herda segredos da aplicação, variáveis Codex ou chaves de outros provedores.
4. Enquanto o processo trabalha, uma verificação a cada cinco segundos renova a
   autorização e guarda alterações do cache cifradas. Arquivos simbólicos,
   arquivos especiais, JSON inválido e cache maior que 64 KiB são recusados.
5. Após a operação, o processo é encerrado antes da última gravação e da remoção
   da área temporária. Um login por dispositivo mantém o processo até terminar,
   ser cancelado ou atingir dez minutos. A conclusão do login funciona mesmo
   depois que a requisição HTTP inicial encerrou.

O Compose monta `/tmp` em **tmpfs de 256 MiB** tanto no app quanto no worker.
Assim, a cópia nativa ativa não vai para o volume persistente e desaparece ao
recriar o container. Na execução local fora do Docker, usa-se o diretório
temporário do sistema, com as mesmas permissões e limpeza; ele pode estar em disco.

## Revogação e concorrência

Desconectar limpa o segredo cifrado e invalida a trava. Processos antigos não
conseguem persistir nem restaurar sua cópia. Um turno ativo em outro processo é
interrompido na próxima verificação, normalmente em até cinco segundos; operações
externas já enviadas não são desfeitas. Suspensão da conta e expiração da trava
impedem novas gravações da mesma forma. Falhas de banco encerram a conexão em vez
de usar um armazenamento alternativo.

Cancelar somente o login preserva a sessão anterior já persistida, mas invalida
a tentativa pendente. O estado da conta pode ser consultado por outro processo
sem disputar a trava. O catálogo fica em cache por quinze minutos; consultas
nativas durante a execução usam a sessão reservada para aquela operação.

Depois de queda abrupta, outro processo pode adquirir a sessão quando a trava
expirar. Ele restaura a última cópia cifrada confirmada. Uma renovação externa
que ocorreu imediatamente antes da queda pode não ter sido confirmada no banco;
nesse caso, é necessário reconectar. Não há promessa de atomicidade entre o
provedor externo e o PostgreSQL, nem repetição automática do turno interrompido.

## Atualização e backups

O antigo diretório privado `data/users/{id}/chatgpt` não é importado e é removido
quando uma nova conexão nativa é aberta para esse usuário. Contas que usavam
esse cache precisam conectar novamente. Na atualização, pare app e workers antigos
antes de subir a nova versão; não mantenha processos antigos usando esse diretório.
O cache global da versão de conta única também não é usado.

Backups novos devem incluir PostgreSQL e a chave mestra guardada separadamente.
O estado de autenticação ChatGPT não depende mais do volume `dados`. Backups
anteriores que contenham o cache em texto puro precisam do mesmo cuidado dado a
qualquer cópia de credenciais.

## Validação

`lib/saas-chatgpt-session.test.ts` verifica cifragem e vínculo ao dono, renovação,
restauração, limpeza, dois processos disputando a sessão, gravação após expiração,
logout, suspensão, arquivo simbólico/tamanho, revogação durante um turno e
parada forçada do launcher junto com seu processo filho.
`lib/chatgpt.test.ts` usa sessões reais da aplicação com o simulador do protocolo
para login, modelos, ferramentas, imagens, cancelamento e limites de uso.

Nesta etapa passaram **296 testes gerais e 92 cenários no PostgreSQL servidor**.
Build passou; lint sem erros, com o aviso anterior do avatar do chat. O teste Docker
verifica tmpfs, abre o Codex instalado sem credenciais reais, usa o simulador para
login/turno e verifica que a sessão cifrada persiste após recriar containers.
Essa jornada Docker passou, assim como os testes de navegador em desktop e celular.
Login real e geração em uma conta ChatGPT externa não fazem parte desses testes.
