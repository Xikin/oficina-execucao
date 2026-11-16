import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../../src/config/prisma';
import { PrismaExecucaoRepository } from '../../src/infrastructure/database/repositories/prisma-execucoes.repository';
import {
  PrismaPecaRepository,
  PrismaServicoRepository,
} from '../../src/infrastructure/database/repositories/prisma-catalogo.repository';
import {
  EstoqueInsuficienteError,
  ExecucaoAlteradaError,
  type TransicaoExecucao,
} from '../../src/domain/repositories/execucoes.repository.interface';
import { EXEC_ID } from '../fixtures';

const usarMockComoTransacao = () =>
  vi
    .mocked(prisma.$transaction)
    .mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);

const linhaDoBanco = (status = 'DIAGNOSTICADA') => ({
  id: EXEC_ID,
  status,
  criadoEm: new Date(),
  servicos: [
    { id: '1', servicoId: 's', nome: 'S', preco: { toNumber: () => 200 }, tempoReal: null },
  ],
  reservas: [
    {
      id: 'r',
      pecaId: 'p',
      nome: 'P',
      quantidade: 1,
      precoUnitario: { toNumber: () => 85 },
      status: 'RESERVADA',
    },
  ],
  historico: [],
});

const transicao = (sobrescrever: Partial<TransicaoExecucao> = {}): TransicaoExecucao => ({
  execucaoId: EXEC_ID,
  statusEsperado: 'EM_DIAGNOSTICO',
  novoStatus: 'DIAGNOSTICADA',
  observacao: 'ok',
  saidas: [],
  mensagemProcessada: null,
  ...sobrescrever,
});

describe('PrismaExecucaoRepository.transicionar', () => {
  it('rejeita quando outro processo já mudou o status', async () => {
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 0 } as never);
    await expect(new PrismaExecucaoRepository().transicionar(transicao())).rejects.toThrow(
      ExecucaoAlteradaError,
    );
  });

  it('reserva com baixa condicionada e grava itens, histórico e outbox', async () => {
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.peca.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.execucao.findUniqueOrThrow).mockResolvedValue(linhaDoBanco() as never);

    const r = await new PrismaExecucaoRepository().transicionar(
      transicao({
        observacaoDiagnostico: 'gasto',
        servicos: [{ servicoId: 's', nome: 'S', preco: 200 }],
        reservar: [{ pecaId: 'p', nome: 'P', quantidade: 2, precoUnitario: 85 }],
        saidas: [
          {
            mensagem: {
              id: 'ev',
              tipo: 'execucao.evento.diagnostico-concluido',
              versao: 1,
              sagaId: 's',
              ordemId: 'o',
              causadaPor: null,
              origem: 'oficina-execucao',
              ocorridaEm: '',
              dados: {},
            },
            cabecalhos: {},
          },
        ],
        mensagemProcessada: { id: 'm', consumidor: 'execucao.comandos' },
      }),
    );

    expect(prisma.execucao.updateMany).toHaveBeenCalledWith({
      where: { id: EXEC_ID, status: 'EM_DIAGNOSTICO' },
      data: expect.objectContaining({
        status: 'DIAGNOSTICADA',
        diagnosticadaEm: expect.any(Date),
        observacaoDiagnostico: 'gasto',
      }),
    });
    expect(prisma.peca.updateMany).toHaveBeenCalledWith({
      where: { id: 'p', ativo: true, quantidade: { gte: 2 } },
      data: { quantidade: { decrement: 2 } },
    });
    expect(prisma.reservaPeca.create).toHaveBeenCalled();
    expect(prisma.itemServicoExecucao.createMany).toHaveBeenCalled();
    expect(prisma.historicoExecucao.create).toHaveBeenCalled();
    expect(prisma.outbox.createMany).toHaveBeenCalled();
    expect(prisma.mensagemProcessada.create).toHaveBeenCalled();
    expect(r.servicos[0].preco).toBe(200);
    expect(r.reservas[0].precoUnitario).toBe(85);
  });

  it('falha a transação inteira se faltar estoque', async () => {
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.peca.updateMany).mockResolvedValue({ count: 0 } as never);
    await expect(
      new PrismaExecucaoRepository().transicionar(
        transicao({
          reservar: [{ pecaId: 'p', nome: 'Pastilha', quantidade: 99, precoUnitario: 1 }],
        }),
      ),
    ).rejects.toThrow(EstoqueInsuficienteError);
    expect(prisma.reservaPeca.create).not.toHaveBeenCalled();
  });

  it('libera reservas devolvendo ao estoque, consome e registra tempo', async () => {
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.reservaPeca.findMany).mockResolvedValue([
      { id: 'r1', pecaId: 'p1', quantidade: 2 },
    ] as never);
    vi.mocked(prisma.execucao.findUniqueOrThrow).mockResolvedValue(linhaDoBanco() as never);
    const repo = new PrismaExecucaoRepository();

    await repo.transicionar(
      transicao({
        statusEsperado: 'DIAGNOSTICADA',
        novoStatus: 'CANCELADA',
        liberarReservas: true,
        motivoEncerramento: 'x',
      }),
    );
    expect(prisma.peca.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { quantidade: { increment: 2 } },
    });
    expect(prisma.reservaPeca.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] } },
      data: { status: 'LIBERADA' },
    });

    await repo.transicionar(
      transicao({
        statusEsperado: 'AGUARDANDO_REPARO',
        novoStatus: 'EM_REPARO',
        consumirReservas: true,
      }),
    );
    expect(prisma.reservaPeca.updateMany).toHaveBeenCalledWith({
      where: { execucaoId: EXEC_ID, status: 'RESERVADA' },
      data: { status: 'CONSUMIDA' },
    });

    await repo.transicionar(
      transicao({
        statusEsperado: 'EM_REPARO',
        novoStatus: 'FINALIZADA',
        tempoRealMin: 60,
        tempoPorServico: 60,
      }),
    );
    expect(prisma.itemServicoExecucao.updateMany).toHaveBeenCalledWith({
      where: { execucaoId: EXEC_ID },
      data: { tempoReal: 60 },
    });
  });

  it('mantém o status sem marco de data quando a transição é só um registro', async () => {
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.execucao.findUniqueOrThrow).mockResolvedValue(linhaDoBanco('FALHOU') as never);
    await new PrismaExecucaoRepository().transicionar(
      transicao({ statusEsperado: 'FALHOU', novoStatus: 'FALHOU', liberarReservas: false }),
    );
    const dados = vi.mocked(prisma.execucao.updateMany).mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(dados).toEqual({ status: 'FALHOU' });
  });
});

describe('PrismaExecucaoRepository — demais operações', () => {
  it('cria em transação com histórico e saídas', async () => {
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.create).mockResolvedValue(linhaDoBanco('NA_FILA') as never);
    const saidas = vi.fn().mockReturnValue([]);
    await new PrismaExecucaoRepository().criar(
      {
        ordemId: 'o',
        sagaId: 's',
        numeroOS: 1,
        status: 'NA_FILA',
        descricao: null,
        veiculo: null,
        motivoEncerramento: null,
        observacao: 'x',
      },
      saidas,
      { id: 'm', consumidor: 'c' },
    );
    expect(saidas).toHaveBeenCalled();
    expect(prisma.mensagemProcessada.create).toHaveBeenCalledWith({
      data: { id: 'm', consumidor: 'c' },
    });
  });

  it('lista a fila priorizando o que está em reparo', async () => {
    vi.mocked(prisma.execucao.findMany).mockResolvedValue([
      { ...linhaDoBanco('NA_FILA'), id: 'a', criadoEm: new Date(1) },
      { ...linhaDoBanco('EM_REPARO'), id: 'b', criadoEm: new Date(2) },
    ] as never);
    vi.mocked(prisma.execucao.count).mockResolvedValue(2 as never);
    const { data } = await new PrismaExecucaoRepository().listar({ page: 1, limit: 10 });
    expect(data.map((e) => e.id)).toEqual(['b', 'a']);
    await new PrismaExecucaoRepository().listar({ page: 1, limit: 10, status: 'FINALIZADA' });
    expect(prisma.execucao.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { status: 'FINALIZADA' } }),
    );
  });

  it('busca e deduplicação', async () => {
    const repo = new PrismaExecucaoRepository();
    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(null);
    expect(await repo.buscarPorId('x')).toBeNull();
    expect(await repo.buscarPorOrdem('x')).toBeNull();
    vi.mocked(prisma.mensagemProcessada.findUnique).mockResolvedValue({
      id: 'm',
      consumidor: 'c',
    } as never);
    expect(await repo.jaProcessada('m', 'c')).toBe(true);
    await repo.registrarProcessada('m2', 'c');
    expect(prisma.mensagemProcessada.create).toHaveBeenCalledWith({
      data: { id: 'm2', consumidor: 'c' },
    });
  });
});

describe('repositórios do catálogo', () => {
  it('ajuste negativo usa baixa condicionada e devolve null sem saldo', async () => {
    const repo = new PrismaPecaRepository();
    vi.mocked(prisma.peca.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    expect(await repo.ajustarEstoque('p', -5)).toBeNull();
    expect(prisma.peca.updateMany).toHaveBeenCalledWith({
      where: { id: 'p', ativo: true, quantidade: { gte: 5 } },
      data: { quantidade: { increment: -5 } },
    });
    vi.mocked(prisma.peca.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.peca.findFirst).mockResolvedValue({ id: 'p', preco: 10 } as never);
    expect((await repo.ajustarEstoque('p', 3))?.preco).toBe(10);
  });

  it('busca várias peças e serviços só quando há ids', async () => {
    expect(await new PrismaPecaRepository().buscarVarias([])).toEqual([]);
    expect(await new PrismaServicoRepository().buscarVarios([])).toEqual([]);
    vi.mocked(prisma.servico.findMany).mockResolvedValue([
      { id: 's', preco: { toNumber: () => 9.9 } },
    ] as never);
    expect((await new PrismaServicoRepository().buscarVarios(['s']))[0].preco).toBe(9.9);
  });

  it('serviço em execução ativa e tempos reais', async () => {
    const repo = new PrismaServicoRepository();
    vi.mocked(prisma.itemServicoExecucao.findFirst).mockResolvedValue(null);
    expect(await repo.emExecucaoAtiva('s')).toBe(false);
    vi.mocked(prisma.itemServicoExecucao.findMany).mockResolvedValue([{ tempoReal: 30 }] as never);
    expect(await repo.temposReais('s')).toEqual([30]);
  });
});
