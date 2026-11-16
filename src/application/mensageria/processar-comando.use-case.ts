import { interpretarComando, novoEvento } from './contratos';
import { COMANDOS, EVENTOS, type Mensagem } from '../../domain/mensageria/mensagem';
import { STATUS_LABEL, permite } from '../../domain/execucao/execucao';
import type { IExecucaoRepository } from '../../domain/repositories/execucoes.repository.interface';
import type { ILogger } from '../../domain/services/logger.service.interface';
import type { IRastreamento } from '../../domain/services/rastreamento.interface';

export const CONSUMIDOR_COMANDOS = 'execucao.comandos';

export class ProcessarComandoUseCase {
  constructor(
    private readonly repo: IExecucaoRepository,
    private readonly rastreamento: IRastreamento,
    private readonly logger: ILogger,
  ) {}

  async execute(mensagem: Mensagem): Promise<void> {
    if (await this.repo.jaProcessada(mensagem.id, CONSUMIDOR_COMANDOS)) {
      this.logger.info(
        { evento: 'mensagem_duplicada', mensagemId: mensagem.id, tipoMensagem: mensagem.tipo },
        'comando já processado; descartado',
      );
      return;
    }

    const comando = interpretarComando(mensagem);
    const processada = { id: mensagem.id, consumidor: CONSUMIDOR_COMANDOS };
    const existente = await this.repo.buscarPorOrdem(mensagem.ordemId);
    const contexto = {
      ordemId: mensagem.ordemId,
      sagaId: mensagem.sagaId,
      numeroOS: comando.numeroOS,
      mensagemId: mensagem.id,
      tipoMensagem: mensagem.tipo,
    };

    switch (comando.tipo) {
      case COMANDOS.ABRIR_DIAGNOSTICO: {
        if (existente) {
          this.logger.warn(
            { evento: 'comando_ignorado', ...contexto, statusAtual: existente.status },
            'a OS já está na fila de execução',
          );
          await this.repo.registrarProcessada(mensagem.id, CONSUMIDOR_COMANDOS);
          return;
        }
        await this.repo.criar(
          {
            ordemId: mensagem.ordemId,
            sagaId: mensagem.sagaId,
            numeroOS: comando.numeroOS,
            status: 'NA_FILA',
            descricao: comando.descricao ?? null,
            veiculo: comando.veiculo,
            motivoEncerramento: null,
            observacao: 'OS recebida na fila de diagnóstico',
          },
          () => [],
          processada,
        );
        this.logger.info({ evento: 'execucao_enfileirada', ...contexto }, 'OS entrou na fila');
        return;
      }

      case COMANDOS.LIBERAR_EXECUCAO: {
        if (!existente || !permite('liberar', existente.status)) {
          this.logger.warn(
            { evento: 'comando_ignorado', ...contexto, statusAtual: existente?.status ?? null },
            'liberação recebida fora de hora',
          );
          await this.repo.registrarProcessada(mensagem.id, CONSUMIDOR_COMANDOS);
          return;
        }
        await this.repo.transicionar({
          execucaoId: existente.id,
          statusEsperado: existente.status,
          novoStatus: 'AGUARDANDO_REPARO',
          observacao: 'Pagamento confirmado; liberada para reparo',
          saidas: [],
          mensagemProcessada: processada,
        });
        this.logger.info(
          { evento: 'execucao_status_alterado', ...contexto, statusNovo: 'AGUARDANDO_REPARO' },
          'execução liberada para reparo',
        );
        return;
      }

      case COMANDOS.CANCELAR: {
        const evento =
          (pecasDevolvidas: number, jaEncerrada: boolean) =>
          (alvo: { sagaId: string; ordemId: string; numeroOS: number }) => [
            novoEvento(
              EVENTOS.CANCELADA,
              alvo,
              { pecasDevolvidas, jaEncerrada },
              mensagem.id,
              this.rastreamento,
            ),
          ];

        if (!existente) {
          await this.repo.criar(
            {
              ordemId: mensagem.ordemId,
              sagaId: mensagem.sagaId,
              numeroOS: comando.numeroOS,
              status: 'CANCELADA',
              descricao: null,
              veiculo: null,
              motivoEncerramento: comando.motivo,
              observacao: 'Cancelamento recebido antes da abertura do diagnóstico',
            },
            evento(0, false),
            processada,
          );
          this.logger.warn(
            { evento: 'execucao_cancelada_antes_de_abrir', ...contexto },
            'cancelamento chegou antes da abertura; registrado para ignorar a abertura atrasada',
          );
          return;
        }

        const reservadas = existente.reservas.filter((r) => r.status === 'RESERVADA');
        const podeCancelar = permite('cancelar', existente.status);
        await this.repo.transicionar({
          execucaoId: existente.id,
          statusEsperado: existente.status,
          novoStatus: podeCancelar ? 'CANCELADA' : existente.status,
          observacao: podeCancelar
            ? `Cancelada: ${comando.motivo}`
            : `Cancelamento da OS recebido com a execução já ${STATUS_LABEL[existente.status].toLowerCase()}`,
          motivoEncerramento: podeCancelar ? comando.motivo : undefined,
          liberarReservas: podeCancelar,
          saidas: evento(podeCancelar ? reservadas.length : 0, !podeCancelar)(existente),
          mensagemProcessada: processada,
        });
        this.logger.info(
          {
            evento: 'execucao_compensada',
            ...contexto,
            statusAnterior: existente.status,
            pecasDevolvidas: podeCancelar ? reservadas.length : 0,
          },
          'compensação da execução concluída',
        );
        return;
      }
    }
  }
}
