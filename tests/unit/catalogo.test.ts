import { describe, it, expect, vi } from 'vitest';
import * as S from '../../src/application/use-cases/servicos/servicos.use-cases';
import * as P from '../../src/application/use-cases/pecas/pecas.use-cases';
import { BusinessError, ConflictError, NotFoundError, StockError } from '../../src/shared/errors';
import { repoPecas, repoServicos } from '../fixtures';

const servico = { id: 's', nome: 'Óleo', preco: 90 };
const peca = { id: 'p', nome: 'Filtro', preco: 20, quantidade: 3, estoqueMin: 5, unidade: 'un' };

describe('serviços', () => {
  it('cria quando o nome é inédito e recusa duplicado', async () => {
    const repo = repoServicos();
    vi.mocked(repo.buscarPorNome).mockResolvedValueOnce(null);
    vi.mocked(repo.criar).mockResolvedValue(servico as never);
    expect(await new S.CriarServicoUseCase(repo).execute({ nome: 'Óleo', preco: 90 })).toBe(
      servico,
    );
    vi.mocked(repo.buscarPorNome).mockResolvedValueOnce(servico as never);
    await expect(
      new S.CriarServicoUseCase(repo).execute({ nome: 'Óleo', preco: 90 }),
    ).rejects.toThrow(ConflictError);
  });

  it('lista com paginação e busca por id', async () => {
    const repo = repoServicos();
    vi.mocked(repo.listar).mockResolvedValue({ data: [], total: 1 });
    expect(
      (await new S.ListarServicosUseCase(repo).execute({ page: 1, limit: 20 })).meta.total,
    ).toBe(1);
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(new S.BuscarServicoPorIdUseCase(repo).execute('x')).rejects.toThrow(NotFoundError);
  });

  it('atualiza, recusando nome de outro serviço', async () => {
    const repo = repoServicos();
    vi.mocked(repo.buscarPorId).mockResolvedValue(servico as never);
    vi.mocked(repo.buscarPorNome).mockResolvedValueOnce({ id: 'outro' } as never);
    await expect(
      new S.AtualizarServicoUseCase(repo).execute('s', { nome: 'Freio' }),
    ).rejects.toThrow(ConflictError);
    vi.mocked(repo.atualizar).mockResolvedValue(servico as never);
    await new S.AtualizarServicoUseCase(repo).execute('s', { preco: 95 });
    expect(repo.atualizar).toHaveBeenCalledWith('s', { preco: 95 });
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(new S.AtualizarServicoUseCase(repo).execute('s', {})).rejects.toThrow(
      NotFoundError,
    );
  });

  it('não remove serviço em execução ativa', async () => {
    const repo = repoServicos();
    vi.mocked(repo.buscarPorId).mockResolvedValue(servico as never);
    vi.mocked(repo.emExecucaoAtiva).mockResolvedValueOnce(true);
    await expect(new S.RemoverServicoUseCase(repo).execute('s')).rejects.toThrow(BusinessError);
    vi.mocked(repo.emExecucaoAtiva).mockResolvedValueOnce(false);
    await new S.RemoverServicoUseCase(repo).execute('s');
    expect(repo.remover).toHaveBeenCalledWith('s');
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(new S.RemoverServicoUseCase(repo).execute('s')).rejects.toThrow(NotFoundError);
  });

  it('calcula tempo médio real', async () => {
    const repo = repoServicos();
    vi.mocked(repo.buscarPorId).mockResolvedValue(servico as never);
    vi.mocked(repo.temposReais).mockResolvedValueOnce([]);
    expect(await new S.CalcularTempoMedioUseCase(repo).execute('s')).toEqual({
      tempoMedio: null,
      totalExecucoes: 0,
    });
    vi.mocked(repo.temposReais).mockResolvedValueOnce([30, 45]);
    expect(await new S.CalcularTempoMedioUseCase(repo).execute('s')).toEqual({
      tempoMedio: 38,
      totalExecucoes: 2,
    });
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(new S.CalcularTempoMedioUseCase(repo).execute('s')).rejects.toThrow(NotFoundError);
  });
});

describe('peças', () => {
  const nova = { nome: 'Filtro', preco: 20, quantidade: 3, estoqueMin: 5, unidade: 'un' };

  it('cria e recusa duplicada', async () => {
    const repo = repoPecas();
    vi.mocked(repo.buscarPorNome).mockResolvedValueOnce(null);
    await new P.CriarPecaUseCase(repo).execute(nova);
    expect(repo.criar).toHaveBeenCalledWith(nova);
    vi.mocked(repo.buscarPorNome).mockResolvedValueOnce(peca as never);
    await expect(new P.CriarPecaUseCase(repo).execute(nova)).rejects.toThrow(ConflictError);
  });

  it('lista marcando estoque baixo e calcula alertas com déficit', async () => {
    const repo = repoPecas();
    vi.mocked(repo.listar).mockResolvedValue({ data: [peca] as never, total: 1 });
    const lista = await new P.ListarPecasUseCase(repo).execute({ page: 1, limit: 20 });
    expect(lista.data[0].estoqueBaixo).toBe(true);

    vi.mocked(repo.listarTodas).mockResolvedValue([
      peca,
      { ...peca, id: 'ok', quantidade: 50 },
    ] as never);
    expect(await new P.AlertasEstoqueUseCase(repo).execute()).toEqual([{ ...peca, deficit: 2 }]);
  });

  it('busca, atualiza e remove com as validações', async () => {
    const repo = repoPecas();
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(new P.BuscarPecaPorIdUseCase(repo).execute('p')).rejects.toThrow(NotFoundError);
    await expect(new P.AtualizarPecaUseCase(repo).execute('p', {})).rejects.toThrow(NotFoundError);
    await expect(new P.RemoverPecaUseCase(repo).execute('p')).rejects.toThrow(NotFoundError);

    vi.mocked(repo.buscarPorId).mockResolvedValue(peca as never);
    expect(await new P.BuscarPecaPorIdUseCase(repo).execute('p')).toBe(peca);
    vi.mocked(repo.buscarPorNome).mockResolvedValueOnce({ id: 'outra' } as never);
    await expect(new P.AtualizarPecaUseCase(repo).execute('p', { nome: 'Vela' })).rejects.toThrow(
      ConflictError,
    );
    await new P.AtualizarPecaUseCase(repo).execute('p', { preco: 21 });
    expect(repo.atualizar).toHaveBeenCalledWith('p', { preco: 21 });
    await new P.RemoverPecaUseCase(repo).execute('p');
    expect(repo.remover).toHaveBeenCalledWith('p');
  });

  it('ajuste de estoque nunca deixa o saldo negativo', async () => {
    const repo = repoPecas();
    vi.mocked(repo.buscarPorId).mockResolvedValue(peca as never);
    vi.mocked(repo.ajustarEstoque).mockResolvedValueOnce(null);
    await expect(new P.AjustarEstoqueUseCase(repo).execute('p', -10)).rejects.toThrow(StockError);
    vi.mocked(repo.ajustarEstoque).mockResolvedValueOnce({ ...peca, quantidade: 8 } as never);
    expect((await new P.AjustarEstoqueUseCase(repo).execute('p', 5)).quantidade).toBe(8);
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);
    await expect(new P.AjustarEstoqueUseCase(repo).execute('p', 1)).rejects.toThrow(NotFoundError);
  });
});
