import { describe, it, expect, vi } from 'vitest';
import { ProcessarComandoUseCase } from '../../src/application/mensageria/processar-comando.use-case';
import { COMANDOS, EVENTOS } from '../../src/domain/mensageria/mensagem';
import { execucao, logger, mensagem, rastreamento, repoExecucoes } from '../fixtures';

const abrir = {
  numeroOS: 42,
  descricao: 'Barulho',
  veiculo: { placa: 'ABC1D23', marca: 'VW', modelo: 'Gol', ano: 2019 },
};

const montar = () => {
  const repo = repoExecucoes();
  return { repo, uc: new ProcessarComandoUseCase(repo, rastreamento, logger) };
};

describe('ProcessarComandoUseCase', () => {
  it('abrir diagnóstico coloca a OS na fila com os dados do veículo', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(null);

    await uc.execute(mensagem(COMANDOS.ABRIR_DIAGNOSTICO, abrir));

    const [nova, saidas, processada] = vi.mocked(repo.criar).mock.calls[0];
    expect(nova).toMatchObject({
      status: 'NA_FILA',
      numeroOS: 42,
      sagaId: 'saga-1',
      veiculo: abrir.veiculo,
    });
    expect(saidas(execucao())).toEqual([]);
    expect(processada).toEqual({ id: 'cmd-1', consumidor: 'execucao.comandos' });
  });

  it('abrir diagnóstico repetido ou atrasado é ignorado', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(execucao({ status: 'CANCELADA' }));
    await uc.execute(mensagem(COMANDOS.ABRIR_DIAGNOSTICO, { ...abrir, descricao: null }));
    expect(repo.criar).not.toHaveBeenCalled();
    expect(repo.registrarProcessada).toHaveBeenCalledWith('cmd-1', 'execucao.comandos');
  });

  it('liberar execução após o pagamento move para aguardando reparo', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(execucao({ status: 'DIAGNOSTICADA' }));
    await uc.execute(mensagem(COMANDOS.LIBERAR_EXECUCAO, { numeroOS: 42 }));
    expect(repo.transicionar).toHaveBeenCalledWith(
      expect.objectContaining({
        statusEsperado: 'DIAGNOSTICADA',
        novoStatus: 'AGUARDANDO_REPARO',
        saidas: [],
      }),
    );
  });

  it('liberar fora de hora é registrado e ignorado', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(null);
    await uc.execute(mensagem(COMANDOS.LIBERAR_EXECUCAO, { numeroOS: 42 }));
    expect(repo.transicionar).not.toHaveBeenCalled();
    expect(repo.registrarProcessada).toHaveBeenCalled();
  });

  it('cancelar devolve as peças reservadas e confirma a compensação', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(
      execucao({
        status: 'DIAGNOSTICADA',
        reservas: [
          { id: 'r', pecaId: 'p', nome: 'F', quantidade: 2, precoUnitario: 1, status: 'RESERVADA' },
        ],
      }),
    );

    await uc.execute(mensagem(COMANDOS.CANCELAR, { numeroOS: 42, motivo: 'Reprovado' }));

    const t = vi.mocked(repo.transicionar).mock.calls[0][0];
    expect(t).toMatchObject({
      novoStatus: 'CANCELADA',
      liberarReservas: true,
      motivoEncerramento: 'Reprovado',
    });
    expect(t.saidas[0].mensagem).toMatchObject({
      tipo: EVENTOS.CANCELADA,
      causadaPor: 'cmd-1',
      dados: { numeroOS: 42, pecasDevolvidas: 1, jaEncerrada: false },
    });
  });

  it('cancelar execução já encerrada não muda nada, mas confirma para a saga não travar', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(execucao({ status: 'FALHOU' }));

    await uc.execute(mensagem(COMANDOS.CANCELAR, { numeroOS: 42, motivo: 'x' }));

    const t = vi.mocked(repo.transicionar).mock.calls[0][0];
    expect(t.novoStatus).toBe('FALHOU');
    expect(t.liberarReservas).toBe(false);
    expect(t.saidas[0].mensagem.dados).toMatchObject({ jaEncerrada: true, pecasDevolvidas: 0 });
  });

  it('cancelar antes da abertura grava a execução já cancelada e confirma', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.buscarPorOrdem).mockResolvedValue(null);

    await uc.execute(mensagem(COMANDOS.CANCELAR, { numeroOS: 42, motivo: 'Desistiu' }));

    const [nova, saidas] = vi.mocked(repo.criar).mock.calls[0];
    expect(nova).toMatchObject({ status: 'CANCELADA', motivoEncerramento: 'Desistiu' });
    expect(saidas(execucao())[0].mensagem.tipo).toBe(EVENTOS.CANCELADA);
  });

  it('descarta comando duplicado', async () => {
    const { repo, uc } = montar();
    vi.mocked(repo.jaProcessada).mockResolvedValue(true);
    await uc.execute(mensagem(COMANDOS.LIBERAR_EXECUCAO, { numeroOS: 42 }));
    expect(repo.buscarPorOrdem).not.toHaveBeenCalled();
  });
});
