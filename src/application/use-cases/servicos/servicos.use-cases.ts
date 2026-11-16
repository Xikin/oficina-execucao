import { BusinessError, ConflictError, NotFoundError } from '../../../shared/errors';
import type {
  AtualizarServicoData,
  CriarServicoData,
  IServicoRepository,
  ListarServicosParams,
} from '../../../domain/repositories/servicos.repository.interface';

export class CriarServicoUseCase {
  constructor(private readonly repo: IServicoRepository) {}

  async execute(data: CriarServicoData) {
    if (await this.repo.buscarPorNome(data.nome))
      throw new ConflictError('Já existe um serviço com este nome');
    return this.repo.criar(data);
  }
}

export class ListarServicosUseCase {
  constructor(private readonly repo: IServicoRepository) {}

  async execute(params: ListarServicosParams) {
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

export class BuscarServicoPorIdUseCase {
  constructor(private readonly repo: IServicoRepository) {}

  async execute(id: string) {
    const servico = await this.repo.buscarPorId(id);
    if (!servico) throw new NotFoundError('Serviço');
    return servico;
  }
}

export class AtualizarServicoUseCase {
  constructor(private readonly repo: IServicoRepository) {}

  async execute(id: string, data: AtualizarServicoData) {
    if (!(await this.repo.buscarPorId(id))) throw new NotFoundError('Serviço');
    if (data.nome && (await this.repo.buscarPorNome(data.nome, id)))
      throw new ConflictError('Já existe um serviço com este nome');
    return this.repo.atualizar(id, data);
  }
}

export class RemoverServicoUseCase {
  constructor(private readonly repo: IServicoRepository) {}

  async execute(id: string) {
    if (!(await this.repo.buscarPorId(id))) throw new NotFoundError('Serviço');
    if (await this.repo.emExecucaoAtiva(id))
      throw new BusinessError('Serviço está em uma execução em andamento');
    return this.repo.remover(id);
  }
}

export class CalcularTempoMedioUseCase {
  constructor(private readonly repo: IServicoRepository) {}

  async execute(id: string) {
    if (!(await this.repo.buscarPorId(id))) throw new NotFoundError('Serviço');
    const tempos = await this.repo.temposReais(id);
    if (!tempos.length) return { tempoMedio: null, totalExecucoes: 0 };
    const soma = tempos.reduce((acc, t) => acc + t, 0);
    return { tempoMedio: Math.round(soma / tempos.length), totalExecucoes: tempos.length };
  }
}
