import { ConflictError, NotFoundError, StockError } from '../../../shared/errors';
import type {
  AtualizarPecaData,
  CriarPecaData,
  IPecaRepository,
  ListarPecasParams,
} from '../../../domain/repositories/pecas.repository.interface';

export class CriarPecaUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute(data: CriarPecaData) {
    if (await this.repo.buscarPorNome(data.nome))
      throw new ConflictError('Já existe uma peça com este nome');
    return this.repo.criar(data);
  }
}

export class ListarPecasUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute(params: ListarPecasParams) {
    const { data, total } = await this.repo.listar(params);
    return {
      data: data.map((p) => ({ ...p, estoqueBaixo: p.quantidade <= p.estoqueMin })),
      meta: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }
}

export class BuscarPecaPorIdUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute(id: string) {
    const peca = await this.repo.buscarPorId(id);
    if (!peca) throw new NotFoundError('Peça');
    return peca;
  }
}

export class AtualizarPecaUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute(id: string, data: AtualizarPecaData) {
    if (!(await this.repo.buscarPorId(id))) throw new NotFoundError('Peça');
    if (data.nome && (await this.repo.buscarPorNome(data.nome, id)))
      throw new ConflictError('Já existe uma peça com este nome');
    return this.repo.atualizar(id, data);
  }
}

export class AjustarEstoqueUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute(id: string, quantidade: number) {
    const peca = await this.repo.buscarPorId(id);
    if (!peca) throw new NotFoundError('Peça');
    const ajustada = await this.repo.ajustarEstoque(id, quantidade);
    if (!ajustada) throw new StockError(`Estoque insuficiente. Disponível: ${peca.quantidade}`);
    return ajustada;
  }
}

export class AlertasEstoqueUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute() {
    const todas = await this.repo.listarTodas();
    return todas
      .filter((p) => p.quantidade <= p.estoqueMin)
      .map((p) => ({ ...p, deficit: p.estoqueMin - p.quantidade }));
  }
}

export class RemoverPecaUseCase {
  constructor(private readonly repo: IPecaRepository) {}

  async execute(id: string) {
    if (!(await this.repo.buscarPorId(id))) throw new NotFoundError('Peça');
    return this.repo.remover(id);
  }
}
