import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { RabbitMQ } from './infrastructure/mensageria/rabbitmq';
import { OutboxRelay } from './infrastructure/mensageria/outbox-relay';
import { RastreamentoNewRelic } from './infrastructure/observabilidade/rastreamento-newrelic';
import { PrismaExecucaoRepository } from './infrastructure/database/repositories/prisma-execucoes.repository';
import {
  CONSUMIDOR_COMANDOS,
  ProcessarComandoUseCase,
} from './application/mensageria/processar-comando.use-case';
import { lerEnvelope } from './application/mensageria/contratos';
import { SERVICO_EXECUCAO } from './domain/mensageria/mensagem';

async function start() {
  const rastreamento = new RastreamentoNewRelic();
  let mensageria: RabbitMQ | null = null;

  const app = await buildApp({
    rastreamento,
    mensageria: env.RABBITMQ_URL
      ? {
          get conectado() {
            return mensageria?.conectado ?? false;
          },
        }
      : null,
  });
  const logger = app.log;

  await prisma.$connect();

  let relay: OutboxRelay | null = null;
  if (env.RABBITMQ_URL) {
    mensageria = new RabbitMQ({
      url: env.RABBITMQ_URL,
      exchange: env.RABBITMQ_EXCHANGE,
      servico: SERVICO_EXECUCAO,
      maxTentativas: env.MENSAGERIA_MAX_TENTATIVAS,
      atrasoRetentativaMs: env.MENSAGERIA_ATRASO_RETENTATIVA_MS,
      logger,
      rastreamento,
    });
    const processar = new ProcessarComandoUseCase(
      new PrismaExecucaoRepository(),
      rastreamento,
      logger,
    );
    mensageria.registrar({
      fila: CONSUMIDOR_COMANDOS,
      bindings: ['execucao.comando.#'],
      prefetch: 1,
      tratar: (bruto) => processar.execute(lerEnvelope(bruto)),
    });
    await mensageria.conectar();

    relay = new OutboxRelay(mensageria, logger, {
      intervaloMs: env.OUTBOX_INTERVALO_MS,
      lote: 50,
      retencaoHoras: 72,
    });
    relay.iniciar();
  } else {
    logger.warn(
      { evento: 'mensageria_desligada' },
      'RABBITMQ_URL ausente: comandos da saga não serão recebidos',
    );
  }

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ evento: 'servidor_iniciado', porta: env.PORT }, 'serviço de execução no ar');

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    logger.info({ evento: 'encerramento_iniciado', sinal }, 'encerrando graciosamente');
    try {
      await app.close();
      await relay?.parar();
      await mensageria?.encerrar();
      await prisma.$disconnect();
      process.exit(0);
    } catch (erro) {
      logger.error({ evento: 'encerramento_falhou', err: erro }, 'falha ao encerrar');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));
}

start().catch((err) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      service: 'oficina-execucao',
      evento: 'falha_ao_iniciar',
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }),
  );
  process.exit(1);
});
