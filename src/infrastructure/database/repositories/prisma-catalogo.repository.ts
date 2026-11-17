import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { STATUS_ENCERRADOS } from '../../../domain/execucao/execucao';
import type {
  AtualizarServicoData,
  CriarServicoData,
  IServicoRepository,
  ListarServicosParams,
  ServicoRecord,
} from '../../../domain/repositories/servicos.repository.interface';
import type {
  AtualizarPecaData,
  CriarPecaData,
  IPecaRepository,
  ListarPecasParams,
  PecaRecord,
} from '../../../domain/repositories/pecas.repository.interface';

type ComPreco = { preco: { toNumber(): number } | number };

function comPrecoNumerico<T extends ComPreco>(r: T): Omit<T, 'preco'> & { preco: number } {
  return { ...r, preco: typeof r.preco === 'number' ? r.preco : r.preco.toNumber() };
}

const busca = (termo?: string) =>
  termo
    ? {
        OR: [
          { nome: { contains: termo, mode: 'insensitive' as const } },
          { descricao: { contains: termo, mode: 'insensitive' as const } },
        ],
      }
    : {};

const mesmoNome = (nome: string, excluir?: string) => ({
  nome: { equals: nome, mode: 'insensitive' as const },
  ativo: true,
  ...(excluir && { NOT: { id: excluir } }),
});

export class PrismaServicoRepository implements IServicoRepository {
  async criar(data: CriarServicoData) {
    return comPrecoNumerico(await prisma.servico.create({ data })) as ServicoRecord;
  }

  async buscarPorId(id: string) {
    const s = await prisma.servico.findFirst({ where: { id, ativo: true } });
    return s ? (comPrecoNumerico(s) as ServicoRecord) : null;
  }

  async buscarVarios(ids: string[]) {
    if (!ids.length) return [];
    const lista = await prisma.servico.findMany({ where: { id: { in: ids }, ativo: true } });
    return lista.map((s) => comPrecoNumerico(s) as ServicoRecord);
  }

  async buscarPorNome(nome: string, excluir?: string) {
    const s = await prisma.servico.findFirst({ where: mesmoNome(nome, excluir) });
    return s ? (comPrecoNumerico(s) as ServicoRecord) : null;
  }

  async listar({ page, limit, busca: termo }: ListarServicosParams) {
    const where: Prisma.ServicoWhereInput = { ativo: true, ...busca(termo) };
    const [data, total] = await Promise.all([
      prisma.servico.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
      }),
      prisma.servico.count({ where }),
    ]);
    return { data: data.map((s) => comPrecoNumerico(s) as ServicoRecord), total };
  }

  async atualizar(id: string, data: AtualizarServicoData) {
    return comPrecoNumerico(await prisma.servico.update({ where: { id }, data })) as ServicoRecord;
  }

  async remover(id: string) {
    return comPrecoNumerico(
      await prisma.servico.update({ where: { id }, data: { ativo: false } }),
    ) as ServicoRecord;
  }

  async emExecucaoAtiva(id: string) {
    const item = await prisma.itemServicoExecucao.findFirst({
      where: { servicoId: id, execucao: { status: { notIn: [...STATUS_ENCERRADOS] } } },
    });
    return item !== null;
  }

  async temposReais(id: string) {
    const itens = await prisma.itemServicoExecucao.findMany({
      where: { servicoId: id, tempoReal: { not: null } },
      select: { tempoReal: true },
    });
    return itens.map((i) => i.tempoReal as number);
  }
}

export class PrismaPecaRepository implements IPecaRepository {
  async criar(data: CriarPecaData) {
    return comPrecoNumerico(await prisma.peca.create({ data })) as PecaRecord;
  }

  async buscarPorId(id: string) {
    const p = await prisma.peca.findFirst({ where: { id, ativo: true } });
    return p ? (comPrecoNumerico(p) as PecaRecord) : null;
  }

  async buscarVarias(ids: string[]) {
    if (!ids.length) return [];
    const lista = await prisma.peca.findMany({ where: { id: { in: ids }, ativo: true } });
    return lista.map((p) => comPrecoNumerico(p) as PecaRecord);
  }

  async buscarPorNome(nome: string, excluir?: string) {
    const p = await prisma.peca.findFirst({ where: mesmoNome(nome, excluir) });
    return p ? (comPrecoNumerico(p) as PecaRecord) : null;
  }

  async listar({ page, limit, busca: termo }: ListarPecasParams) {
    const where: Prisma.PecaWhereInput = { ativo: true, ...busca(termo) };
    const [data, total] = await Promise.all([
      prisma.peca.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { nome: 'asc' },
      }),
      prisma.peca.count({ where }),
    ]);
    return { data: data.map((p) => comPrecoNumerico(p) as PecaRecord), total };
  }

  async listarTodas() {
    return prisma.peca.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, quantidade: true, estoqueMin: true, unidade: true },
    });
  }

  async atualizar(id: string, data: AtualizarPecaData) {
    return comPrecoNumerico(await prisma.peca.update({ where: { id }, data })) as PecaRecord;
  }

  async ajustarEstoque(id: string, delta: number) {
    const { count } = await prisma.peca.updateMany({
      where: { id, ativo: true, ...(delta < 0 && { quantidade: { gte: -delta } }) },
      data: { quantidade: { increment: delta } },
    });
    if (count === 0) return null;
    return this.buscarPorId(id);
  }

  async remover(id: string) {
    return comPrecoNumerico(
      await prisma.peca.update({ where: { id }, data: { ativo: false } }),
    ) as PecaRecord;
  }
}
