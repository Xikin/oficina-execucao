import { describe, it, expect, vi } from 'vitest';
import {
  AcoesDoMecanico,
  BuscarExecucaoUseCase,
  ListarFilaUseCase,
} from '../../src/application/use-cases/execucoes/execucoes.use-cases';
import { EVENTOS } from '../../src/domain/mensageria/mensagem';
import { TransicaoInvalidaError, type StatusExecucao } from '../../src/domain/execucao/execucao';
import { BusinessError, NotFoundError } from '../../src/shared/errors';
import {
  EXEC_ID,
  PECA_ID,
  SERVICO_ID,
  execucao,
  logger,
  rastreamento,
  repoExecucoes,
  repoPecas,
  repoServicos,
} from '../fixtures';

const servico = { id: SERVICO_ID, nome: 'Freio', preco: 200 };
const peca = { id: PECA_ID, nome: 'Pastilha', preco: 85, quantidade: 10 };

function montar(status: StatusExecucao = 'NA_FILA') {
  const repo = repoExecucoes();
  const servicos = repoServicos();
  const pecas = repoPecas();
  vi.mocked(repo.buscarPorId).mockResolvedValue(execucao({ status }));
  vi.mocked(repo.transicionar).mockImplementation(async (t) => execucao({ status: t.novoStatus }));
  return {
    repo,
    servicos,
    pecas,
    acoes: new AcoesDoMecanico(repo, servicos, pecas, rastreamento, logger),
  };
}

describe('consultas da fila', () => {
  it('lista com paginação', async () => {
    const repo = repoExecucoes();
    vi.mocked(repo.listar).mockResolvedValue({ data: [], total: 21 });
    expect(
      (await new ListarFilaUseCase(repo).execute({ page: 1, limit: 10 })).meta.totalPages,
    ).toBe(3);
  });

  it('busca por id e por OS, com 404 quando não existe', async () => {
    const repo = repoExecucoes();
    const uc = new BuscarExecucaoUseCase(repo);
    vi.mocked(repo.buscarPorId).mockResolvedValue(execucao());
    expect((await uc.porId(EXEC_ID)).id).toBe(EXEC_ID);
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(null);
    await expect(uc.porOrdem('x')).rejects.toThrow(NotFoundError);
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(uc.porId('x')).rejects.toThrow(NotFoundError);
  });
});

describe('AcoesDoMecanico', () => {
  it('iniciar diagnóstico publica o evento para o OS Service', async () => {
    const { repo, acoes } = montar('NA_FILA');
    const r = await acoes.iniciarDiagnostico(EXEC_ID);
    expect(r.status).toBe('EM_DIAGNOSTICO');
    const t = vi.mocked(repo.transicionar).mock.calls[0][0];
    expect(t).toMatchObject({ statusEsperado: 'NA_FILA', novoStatus: 'EM_DIAGNOSTICO' });
    expect(t.saidas[0].mensagem).toMatchObject({
      tipo: EVENTOS.DIAGNOSTICO_INICIADO,
      causadaPor: null,
      dados: { numeroOS: 42 },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'execucao_status_alterado', statusNovo: 'EM_DIAGNOSTICO' }),
      expect.any(String),
    );
  });

  it('concluir diagnóstico reserva peças somando duplicadas e envia os itens orçados', async () => {
    const { repo, servicos, pecas, acoes } = montar('EM_DIAGNOSTICO');
    vi.mocked(servicos.buscarVarios).mockResolvedValue([servico] as never);
    vi.mocked(pecas.buscarVarias).mockResolvedValue([peca] as never);

    await acoes.concluirDiagnostico(EXEC_ID, {
      servicos: [{ servicoId: SERVICO_ID }, { servicoId: SERVICO_ID }],
      pecas: [
        { pecaId: PECA_ID, quantidade: 1 },
        { pecaId: PECA_ID, quantidade: 2 },
      ],
      observacao: 'Pastilhas gastas',
    });

    expect(servicos.buscarVarios).toHaveBeenCalledWith([SERVICO_ID]);
    const t = vi.mocked(repo.transicionar).mock.calls[0][0];
    expect(t.reservar).toEqual([
      { pecaId: PECA_ID, nome: 'Pastilha', quantidade: 3, precoUnitario: 85 },
    ]);
    expect(t.servicos).toEqual([{ servicoId: SERVICO_ID, nome: 'Freio', preco: 200 }]);
    expect(t.observacaoDiagnostico).toBe('Pastilhas gastas');
    expect(t.saidas[0].mensagem.tipo).toBe(EVENTOS.DIAGNOSTICO_CONCLUIDO);
    expect(t.saidas[0].mensagem.dados.itens).toEqual([
      {
        tipo: 'SERVICO',
        referenciaId: SERVICO_ID,
        nome: 'Freio',
        quantidade: 1,
        precoUnitario: 200,
      },
      { tipo: 'PECA', referenciaId: PECA_ID, nome: 'Pastilha', quantidade: 3, precoUnitario: 85 },
    ]);
  });

  it('concluir diagnóstico sem itens é recusado', async () => {
    const { acoes } = montar('EM_DIAGNOSTICO');
    await expect(acoes.concluirDiagnostico(EXEC_ID, { servicos: [], pecas: [] })).rejects.toThrow(
      BusinessError,
    );
  });

  it('concluir diagnóstico com serviço ou peça inexistente devolve 404', async () => {
    const { servicos, pecas, acoes } = montar('EM_DIAGNOSTICO');
    vi.mocked(servicos.buscarVarios).mockResolvedValue([]);
    await expect(
      acoes.concluirDiagnostico(EXEC_ID, { servicos: [{ servicoId: SERVICO_ID }], pecas: [] }),
    ).rejects.toThrow(/Serviço/);

    vi.mocked(servicos.buscarVarios).mockResolvedValue([]);
    vi.mocked(pecas.buscarVarias).mockResolvedValue([]);
    await expect(
      acoes.concluirDiagnostico(EXEC_ID, {
        servicos: [],
        pecas: [{ pecaId: PECA_ID, quantidade: 1 }],
      }),
    ).rejects.toThrow(/Peça/);
  });

  it('iniciar reparo consome as reservas', async () => {
    const { repo, acoes } = montar('AGUARDANDO_REPARO');
    await acoes.iniciarReparo(EXEC_ID);
    expect(vi.mocked(repo.transicionar).mock.calls[0][0]).toMatchObject({
      novoStatus: 'EM_REPARO',
      consumirReservas: true,
    });
  });

  it('iniciar reparo antes do pagamento é recusado', async () => {
    const { acoes } = montar('DIAGNOSTICADA');
    await expect(acoes.iniciarReparo(EXEC_ID)).rejects.toThrow(TransicaoInvalidaError);
  });

  it('finalizar com tempo informado divide entre os serviços', async () => {
    const { repo, acoes } = montar('EM_REPARO');
    vi.mocked(repo.buscarPorId).mockResolvedValue(
      execucao({
        status: 'EM_REPARO',
        servicos: [
          { id: '1', servicoId: 'a', nome: 'a', preco: 1, tempoReal: null },
          { id: '2', servicoId: 'b', nome: 'b', preco: 1, tempoReal: null },
        ],
      }),
    );
    await acoes.finalizarReparo(EXEC_ID, 90);
    const t = vi.mocked(repo.transicionar).mock.calls[0][0];
    expect(t).toMatchObject({ novoStatus: 'FINALIZADA', tempoRealMin: 90, tempoPorServico: 45 });
    expect(t.saidas[0].mensagem.dados).toMatchObject({ tempoRealMin: 90 });
  });

  it('finalizar sem tempo usa o tempo desde o início do reparo', async () => {
    const { repo, acoes } = montar('EM_REPARO');
    vi.mocked(repo.buscarPorId).mockResolvedValue(
      execucao({ status: 'EM_REPARO', reparoIniciadoEm: new Date(Date.now() - 30 * 60_000) }),
    );
    await acoes.finalizarReparo(EXEC_ID);
    expect(vi.mocked(repo.transicionar).mock.calls[0][0].tempoRealMin).toBe(30);
  });

  it('registrar falha devolve reservas e publica o motivo', async () => {
    const { repo, acoes } = montar('EM_REPARO');
    await acoes.registrarFalha(EXEC_ID, 'Peça errada');
    const t = vi.mocked(repo.transicionar).mock.calls[0][0];
    expect(t).toMatchObject({
      novoStatus: 'FALHOU',
      liberarReservas: true,
      motivoEncerramento: 'Peça errada',
    });
    expect(t.saidas[0].mensagem).toMatchObject({
      tipo: EVENTOS.EXECUCAO_FALHOU,
      dados: { motivo: 'Peça errada' },
    });
  });

  it('404 para execução inexistente', async () => {
    const { repo, acoes } = montar();
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(acoes.iniciarDiagnostico(EXEC_ID)).rejects.toThrow(NotFoundError);
  });
});
