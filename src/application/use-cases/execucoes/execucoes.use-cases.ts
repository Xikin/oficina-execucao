import { BusinessError, NotFoundError } from '../../../shared/errors';
import { novoEvento } from '../../mensageria/contratos';
import { EVENTOS, type TipoEvento } from '../../../domain/mensageria/mensagem';
import { dividirTempo, proximoStatus, type AcaoExecucao } from '../../../domain/execucao/execucao';
import type {
  ExecucaoRecord,
  IExecucaoRepository,
  ListarExecucoesParams,
  TransicaoExecucao,
} from '../../../domain/repositories/execucoes.repository.interface';
import type { IServicoRepository } from '../../../domain/repositories/servicos.repository.interface';
import type { IPecaRepository } from '../../../domain/repositories/pecas.repository.interface';
import type { ILogger } from '../../../domain/services/logger.service.interface';
import type { IRastreamento } from '../../../domain/services/rastreamento.interface';

export class ListarFilaUseCase {
  constructor(private readonly repo: IExecucaoRepository) {}

  async execute(params: ListarExecucoesParams) {
    const { data, total } = await this.repo.listar(params);
    return {
      data,
      meta: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }
}

export class BuscarExecucaoUseCase {
  constructor(private readonly repo: IExecucaoRepository) {}

  async porId(id: string) {
    const execucao = await this.repo.buscarPorId(id);
    if (!execucao) throw new NotFoundError('Execução');
    return execucao;
  }

  async porOrdem(ordemId: string) {
    const execucao = await this.repo.buscarPorOrdem(ordemId);
    if (!execucao) throw new NotFoundError('Execução');
    return execucao;
  }
}

type Complemento = Omit<
  TransicaoExecucao,
  'execucaoId' | 'statusEsperado' | 'novoStatus' | 'saidas' | 'mensagemProcessada' | 'observacao'
>;

export class AcoesDoMecanico {
  constructor(
    private readonly repo: IExecucaoRepository,
    private readonly servicos: IServicoRepository,
    private readonly pecas: IPecaRepository,
    private readonly rastreamento: IRastreamento,
    private readonly logger: ILogger,
  ) {}

  async iniciarDiagnostico(id: string) {
    return this.aplicar(id, 'iniciarDiagnostico', 'Mecânico iniciou o diagnóstico', {
      tipo: EVENTOS.DIAGNOSTICO_INICIADO,
      dados: {},
    });
  }

  async concluirDiagnostico(
    id: string,
    entrada: {
      servicos: { servicoId: string }[];
      pecas: { pecaId: string; quantidade: number }[];
      observacao?: string;
    },
  ) {
    const idsServicos = [...new Set(entrada.servicos.map((s) => s.servicoId))];
    const quantidades = new Map<string, number>();
    for (const p of entrada.pecas)
      quantidades.set(p.pecaId, (quantidades.get(p.pecaId) ?? 0) + p.quantidade);

    if (!idsServicos.length && !quantidades.size)
      throw new BusinessError('Informe ao menos um serviço ou peça para o orçamento');

    const servicos = await this.servicos.buscarVarios(idsServicos);
    const faltaServico = idsServicos.find((sid) => !servicos.some((s) => s.id === sid));
    if (faltaServico) throw new NotFoundError(`Serviço (id: ${faltaServico})`);

    const pecas = await this.pecas.buscarVarias([...quantidades.keys()]);
    const faltaPeca = [...quantidades.keys()].find((pid) => !pecas.some((p) => p.id === pid));
    if (faltaPeca) throw new NotFoundError(`Peça (id: ${faltaPeca})`);

    const reservar = pecas.map((p) => ({
      pecaId: p.id,
      nome: p.nome,
      quantidade: quantidades.get(p.id)!,
      precoUnitario: p.preco,
    }));
    const itens = [
      ...servicos.map((s) => ({
        tipo: 'SERVICO' as const,
        referenciaId: s.id,
        nome: s.nome,
        quantidade: 1,
        precoUnitario: s.preco,
      })),
      ...reservar.map((r) => ({
        tipo: 'PECA' as const,
        referenciaId: r.pecaId,
        nome: r.nome,
        quantidade: r.quantidade,
        precoUnitario: r.precoUnitario,
      })),
    ];

    return this.aplicar(
      id,
      'concluirDiagnostico',
      entrada.observacao ?? 'Diagnóstico concluído',
      { tipo: EVENTOS.DIAGNOSTICO_CONCLUIDO, dados: { itens, observacao: entrada.observacao } },
      {
        observacaoDiagnostico: entrada.observacao,
        servicos: servicos.map((s) => ({ servicoId: s.id, nome: s.nome, preco: s.preco })),
        reservar,
      },
    );
  }

  async iniciarReparo(id: string) {
    return this.aplicar(
      id,
      'iniciarReparo',
      'Reparo iniciado; peças reservadas foram consumidas',
      { tipo: EVENTOS.EXECUCAO_INICIADA, dados: {} },
      { consumirReservas: true },
    );
  }

  async finalizarReparo(id: string, tempoRealMin?: number) {
    const execucao = await this.carregar(id);
    const tempo =
      tempoRealMin ??
      Math.max(
        1,
        Math.round(
          (Date.now() - (execucao.reparoIniciadoEm ?? execucao.criadoEm).getTime()) / 60_000,
        ),
      );
    return this.aplicar(
      execucao,
      'finalizar',
      'Reparo finalizado',
      { tipo: EVENTOS.EXECUCAO_FINALIZADA, dados: { tempoRealMin: tempo } },
      { tempoRealMin: tempo, tempoPorServico: dividirTempo(tempo, execucao.servicos.length) },
    );
  }

  async registrarFalha(id: string, motivo: string) {
    return this.aplicar(
      id,
      'falhar',
      `Falha na execução: ${motivo}`,
      { tipo: EVENTOS.EXECUCAO_FALHOU, dados: { motivo } },
      { motivoEncerramento: motivo, liberarReservas: true },
    );
  }

  private async carregar(id: string): Promise<ExecucaoRecord> {
    const execucao = await this.repo.buscarPorId(id);
    if (!execucao) throw new NotFoundError('Execução');
    return execucao;
  }

  private async aplicar(
    alvo: string | ExecucaoRecord,
    acao: AcaoExecucao,
    observacao: string,
    evento: { tipo: TipoEvento; dados: Record<string, unknown> },
    complemento: Complemento = {},
  ) {
    const execucao = typeof alvo === 'string' ? await this.carregar(alvo) : alvo;
    const novoStatus = proximoStatus(acao, execucao.status);

    const atualizada = await this.repo.transicionar({
      execucaoId: execucao.id,
      statusEsperado: execucao.status,
      novoStatus,
      observacao,
      ...complemento,
      saidas: [novoEvento(evento.tipo, execucao, evento.dados, null, this.rastreamento)],
      mensagemProcessada: null,
    });

    const entradaNoStatus = execucao.historico.at(-1)?.criadoEm ?? execucao.criadoEm;
    this.logger.info(
      {
        evento: 'execucao_status_alterado',
        execucaoId: execucao.id,
        ordemId: execucao.ordemId,
        sagaId: execucao.sagaId,
        numeroOS: execucao.numeroOS,
        statusAnterior: execucao.status,
        statusNovo: novoStatus,
        duracaoNoStatusAnteriorMs: Date.now() - new Date(entradaNoStatus).getTime(),
        eventoPublicado: evento.tipo,
      },
      observacao,
    );

    return atualizada;
  }
}
