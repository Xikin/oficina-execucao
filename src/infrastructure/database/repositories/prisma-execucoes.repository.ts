import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { enfileirarNoOutbox } from './prisma-outbox';
import { marcosDoStatus, STATUS_ENCERRADOS } from '../../../domain/execucao/execucao';
import {
  EstoqueInsuficienteError,
  ExecucaoAlteradaError,
  type ExecucaoRecord,
  type IExecucaoRepository,
  type ListarExecucoesParams,
  type NovaExecucao,
  type TransicaoExecucao,
} from '../../../domain/repositories/execucoes.repository.interface';
import type { MensagemSaida } from '../../../domain/mensageria/mensagem';

const include = {
  servicos: true,
  reservas: true,
  historico: { orderBy: { criadoEm: 'asc' as const } },
} satisfies Prisma.ExecucaoInclude;

type Decimal = { toNumber(): number } | number;
const num = (v: Decimal) => (typeof v === 'number' ? v : v.toNumber());

type ExecucaoDoBanco = Prisma.ExecucaoGetPayload<{ include: typeof include }>;

function mapear(e: ExecucaoDoBanco): ExecucaoRecord {
  return {
    ...e,
    servicos: e.servicos.map((s) => ({
      id: s.id,
      servicoId: s.servicoId,
      nome: s.nome,
      preco: num(s.preco),
      tempoReal: s.tempoReal,
    })),
    reservas: e.reservas.map((r) => ({
      id: r.id,
      pecaId: r.pecaId,
      nome: r.nome,
      quantidade: r.quantidade,
      precoUnitario: num(r.precoUnitario),
      status: r.status,
    })),
    historico: e.historico.map((h) => ({
      id: h.id,
      statusAnterior: h.statusAnterior,
      statusNovo: h.statusNovo,
      observacao: h.observacao,
      criadoEm: h.criadoEm,
    })),
  };
}

const PRIORIDADE_NA_FILA: Record<string, number> = {
  EM_REPARO: 1,
  EM_DIAGNOSTICO: 2,
  AGUARDANDO_REPARO: 3,
  NA_FILA: 4,
  DIAGNOSTICADA: 5,
  FINALIZADA: 6,
  FALHOU: 7,
  CANCELADA: 8,
};

async function registrarSaidas(
  tx: Prisma.TransactionClient,
  saidas: MensagemSaida[],
  processada: { id: string; consumidor: string } | null,
) {
  await enfileirarNoOutbox(tx, saidas);
  if (processada) await tx.mensagemProcessada.create({ data: processada });
}

export class PrismaExecucaoRepository implements IExecucaoRepository {
  async buscarPorId(id: string) {
    const e = await prisma.execucao.findUnique({ where: { id }, include });
    return e ? mapear(e) : null;
  }

  async buscarPorOrdem(ordemId: string) {
    const e = await prisma.execucao.findUnique({ where: { ordemId }, include });
    return e ? mapear(e) : null;
  }

  async listar({ page, limit, status }: ListarExecucoesParams) {
    const where: Prisma.ExecucaoWhereInput = status
      ? { status }
      : { status: { notIn: [...STATUS_ENCERRADOS] } };
    const [todas, total] = await Promise.all([
      prisma.execucao.findMany({ where, include, orderBy: { criadoEm: 'asc' } }),
      prisma.execucao.count({ where }),
    ]);
    const ordenadas = todas.sort(
      (a, b) =>
        PRIORIDADE_NA_FILA[a.status] - PRIORIDADE_NA_FILA[b.status] ||
        a.criadoEm.getTime() - b.criadoEm.getTime(),
    );
    return { data: ordenadas.slice((page - 1) * limit, page * limit).map(mapear), total };
  }

  async criar(
    nova: NovaExecucao,
    saidas: (execucao: ExecucaoRecord) => MensagemSaida[],
    processada: { id: string; consumidor: string } | null,
  ) {
    return prisma.$transaction(async (tx) => {
      const criada = await tx.execucao.create({
        data: {
          ordemId: nova.ordemId,
          sagaId: nova.sagaId,
          numeroOS: nova.numeroOS,
          status: nova.status,
          descricao: nova.descricao,
          veiculoPlaca: nova.veiculo?.placa,
          veiculoMarca: nova.veiculo?.marca,
          veiculoModelo: nova.veiculo?.modelo,
          veiculoAno: nova.veiculo?.ano,
          motivoEncerramento: nova.motivoEncerramento,
          ...marcosDoStatus(nova.status),
          historico: { create: { statusNovo: nova.status, observacao: nova.observacao } },
        },
        include,
      });
      const execucao = mapear(criada);
      await registrarSaidas(tx, saidas(execucao), processada);
      return execucao;
    });
  }

  async transicionar(t: TransicaoExecucao) {
    return prisma.$transaction(async (tx) => {
      const mudouStatus = t.novoStatus !== t.statusEsperado;
      const { count } = await tx.execucao.updateMany({
        where: { id: t.execucaoId, status: t.statusEsperado },
        data: {
          status: t.novoStatus,
          ...(mudouStatus && marcosDoStatus(t.novoStatus)),
          ...(t.observacaoDiagnostico !== undefined && {
            observacaoDiagnostico: t.observacaoDiagnostico,
          }),
          ...(t.motivoEncerramento !== undefined && { motivoEncerramento: t.motivoEncerramento }),
          ...(t.tempoRealMin !== undefined && { tempoRealMin: t.tempoRealMin }),
        },
      });
      if (count === 0) throw new ExecucaoAlteradaError(t.execucaoId);

      await tx.historicoExecucao.create({
        data: {
          execucaoId: t.execucaoId,
          statusAnterior: t.statusEsperado,
          statusNovo: t.novoStatus,
          observacao: t.observacao,
        },
      });

      if (t.servicos?.length)
        await tx.itemServicoExecucao.createMany({
          data: t.servicos.map((s) => ({ execucaoId: t.execucaoId, ...s })),
        });

      for (const r of t.reservar ?? []) {
        const baixa = await tx.peca.updateMany({
          where: { id: r.pecaId, ativo: true, quantidade: { gte: r.quantidade } },
          data: { quantidade: { decrement: r.quantidade } },
        });
        if (baixa.count === 0) throw new EstoqueInsuficienteError(r.nome);
        await tx.reservaPeca.create({ data: { execucaoId: t.execucaoId, ...r } });
      }

      if (t.consumirReservas)
        await tx.reservaPeca.updateMany({
          where: { execucaoId: t.execucaoId, status: 'RESERVADA' },
          data: { status: 'CONSUMIDA' },
        });

      if (t.liberarReservas) {
        const pendentes = await tx.reservaPeca.findMany({
          where: { execucaoId: t.execucaoId, status: 'RESERVADA' },
        });
        for (const r of pendentes)
          await tx.peca.update({
            where: { id: r.pecaId },
            data: { quantidade: { increment: r.quantidade } },
          });
        if (pendentes.length)
          await tx.reservaPeca.updateMany({
            where: { id: { in: pendentes.map((r) => r.id) } },
            data: { status: 'LIBERADA' },
          });
      }

      if (t.tempoPorServico)
        await tx.itemServicoExecucao.updateMany({
          where: { execucaoId: t.execucaoId },
          data: { tempoReal: t.tempoPorServico },
        });

      await registrarSaidas(tx, t.saidas, t.mensagemProcessada);

      const atualizada = await tx.execucao.findUniqueOrThrow({
        where: { id: t.execucaoId },
        include,
      });
      return mapear(atualizada);
    });
  }

  async jaProcessada(mensagemId: string, consumidor: string) {
    const registro = await prisma.mensagemProcessada.findUnique({ where: { id: mensagemId } });
    return registro?.consumidor === consumidor;
  }

  async registrarProcessada(mensagemId: string, consumidor: string) {
    await prisma.mensagemProcessada.create({ data: { id: mensagemId, consumidor } });
  }
}
