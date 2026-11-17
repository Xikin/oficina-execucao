# Notas de implementação

O código deste repositório não tem comentários. O que não dá para deduzir lendo o código — o porquê de uma escolha, restrições externas, contratos com os outros repositórios — fica aqui, organizado por arquivo. As decisões de arquitetura da Fase 4 estão nas ADRs do [OS Service](https://github.com/Xikin/tech_challenge/blob/main/docs/adr/README.md).

---

## Domínio

### `src/domain/execucao/execucao.ts`

- A máquina de estados é uma tabela (`TRANSICOES`), não uma sequência de `if`: as regras de quem pode ir para onde ficam visíveis num lugar só, e `permite()` responde sem lançar exceção (usado pelos comandos da saga, que preferem ignorar a falhar).
- `falhar` vale em `AGUARDANDO_REPARO` e em `EM_REPARO`: a peça pode chegar errada antes de o reparo começar.
- `dividirTempo` reparte o tempo real entre os serviços com mínimo de 1 minuto, para que o tempo médio por serviço (`GET /servicos/:id/tempo-medio`) nunca registre zero.

### `src/domain/mensageria/mensagem.ts`

Os nomes de comandos e eventos são o contrato com o OS Service, que tem um arquivo espelho. Mudar um nome aqui exige mudar lá; o envelope tem `versao` para permitir convivência de versões.

## Aplicação

### `src/application/mensageria/processar-comando.use-case.ts`

- **Cancelamento sempre confirma.** Se o cancelamento chega antes da abertura (réplicas diferentes, filas com atraso), cria a execução já `CANCELADA`; a abertura atrasada encontra o registro e é ignorada. Se chega com a execução já encerrada, grava uma linha de histórico e confirma com `jaEncerrada: true`. Em nenhum caso a saga fica esperando uma confirmação que não vem.
- Comandos fora de hora (liberar sem diagnóstico concluído, abrir repetido) são registrados como processados e ignorados, em vez de falhar: repeti-los nunca vai dar certo.
- Só devolve ao estoque reservas ainda `RESERVADA`. Peças `CONSUMIDA` (reparo já iniciado) foram usadas no carro.

### `src/application/use-cases/execucoes/execucoes.use-cases.ts`

- `concluirDiagnostico` remove serviços repetidos e soma peças repetidas antes de reservar. Sem isso, a mesma peça em duas linhas geraria duas reservas e dois itens no orçamento.
- Exige ao menos um serviço ou peça: um orçamento vazio faria o Billing responder `orcamento-falhou` e a saga cancelar a OS.
- Os preços enviados no evento são os do catálogo naquele momento. O OS Service e o Billing guardam essa cópia, e uma mudança de preço depois não altera o orçamento.
- `finalizarReparo` sem `tempoRealMin` usa o tempo desde `reparoIniciadoEm`, arredondado para cima de 1 minuto.

### `src/application/use-cases/servicos` e `pecas`

Portados do monólito da Fase 3. Duas mudanças:

- A remoção de serviço consulta execuções ativas deste serviço, não mais OS do outro banco.
- `AjustarEstoqueUseCase` delega a checagem de saldo ao banco (`ajustarEstoque` com `quantidade >= -delta`). A versão antiga lia o saldo e depois gravava, e dois ajustes simultâneos podiam deixar o estoque negativo.

## Infraestrutura

### `src/infrastructure/database/repositories/prisma-execucoes.repository.ts`

- `transicionar` atualiza a execução com `status` no filtro (`updateMany ... where status = esperado`). Zero linhas afetadas vira `ExecucaoAlteradaError` (409 na API; retentativa na fila). É a concorrência otimista, sem coluna de versão, porque toda mudança relevante muda o status.
- A reserva é `UPDATE pecas SET quantidade = quantidade - n WHERE quantidade >= n`. Se alguma peça não tem saldo, `EstoqueInsuficienteError` desfaz a transação inteira, inclusive as reservas das outras peças e a mudança de status.
- Outbox e `mensagens_processadas` entram na mesma transação da mudança.
- A listagem da fila ordena em memória por prioridade de status: o volume de execuções em andamento de uma oficina é pequeno, e a ordem por prioridade não tem índice útil.

### `src/infrastructure/mensageria/rabbitmq.ts`, `outbox-relay.ts`, `observabilidade/rastreamento-newrelic.ts`

Cópias idênticas das do OS Service, de propósito: cada repositório é independente. Os porquês estão nas [notas do OS Service](https://github.com/Xikin/tech_challenge/blob/main/docs/notas-de-implementacao.md#saga-mensageria-e-cache-fase-4).

### `src/seed.ts` e `k8s/job-catalogo.yaml`

O catálogo inicial é um Job do Kubernetes rodado pelo pipeline, e não um passo da subida do container. Com várias réplicas subindo ao mesmo tempo, todas tentariam criar o mesmo serviço (não há unicidade de nome no banco, porque nomes podem se repetir entre itens desativados). O seed é idempotente por nome. Fica em `src/` para ser compilado: a imagem de produção não tem `tsx`.

### `src/presentation/http/middlewares/auth.middleware.ts`

Só aceita o token interno (emissor `oficina-api`, papel ADMIN ou FUNCIONARIO). O cliente final não tem o que fazer neste serviço, e o segredo de cliente nem é configurado aqui.

## Configuração

### `prisma/schema.prisma`

- Os itens guardam `nome` e `preco` além do id: o histórico da execução continua legível mesmo se o serviço ou a peça for desativado ou mudar de preço.
- `ordemId` é único: uma OS tem no máximo uma execução, o que torna a abertura idempotente.

### `.github/workflows/ci-cd.yml`

Lê `JWT_SECRET` do SSM (publicado pelo deploy do OS Service), e não de um secret do GitHub, para não ter o mesmo segredo cadastrado em três lugares.
