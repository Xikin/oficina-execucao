import { z } from 'zod';
import { STATUS_EXECUCAO, type StatusExecucao } from '../../../domain/execucao/execucao';
import { metaSchema, paginacaoSchema } from './comum.schema';

export const listarFilaSchema = paginacaoSchema.extend({
  status: z.enum(STATUS_EXECUCAO as [StatusExecucao, ...StatusExecucao[]]).optional(),
});

export const ordemParamsSchema = z.object({ ordemId: z.string().uuid() });

export const concluirDiagnosticoSchema = z.object({
  servicos: z.array(z.object({ servicoId: z.string().uuid() })).default([]),
  pecas: z
    .array(z.object({ pecaId: z.string().uuid(), quantidade: z.number().int().positive() }))
    .default([]),
  observacao: z.string().max(2000).optional(),
});

export const finalizarReparoSchema = z.object({
  tempoRealMin: z.number().int().positive().optional(),
});

export const registrarFalhaSchema = z.object({
  motivo: z.string().min(3).max(500),
});

export const execucaoResponseSchema = z.object({
  id: z.string().uuid(),
  ordemId: z.string().uuid(),
  sagaId: z.string(),
  numeroOS: z.number().int(),
  status: z.string(),
  descricao: z.string().nullable(),
  veiculoPlaca: z.string().nullable(),
  veiculoMarca: z.string().nullable(),
  veiculoModelo: z.string().nullable(),
  veiculoAno: z.number().int().nullable(),
  observacaoDiagnostico: z.string().nullable(),
  motivoEncerramento: z.string().nullable(),
  tempoRealMin: z.number().int().nullable(),
  diagnosticoIniciadoEm: z.date().nullable(),
  diagnosticadaEm: z.date().nullable(),
  liberadaEm: z.date().nullable(),
  reparoIniciadoEm: z.date().nullable(),
  finalizadaEm: z.date().nullable(),
  encerradaEm: z.date().nullable(),
  criadoEm: z.date(),
  atualizadoEm: z.date(),
  servicos: z.array(
    z.object({
      id: z.string().uuid(),
      servicoId: z.string().uuid(),
      nome: z.string(),
      preco: z.number(),
      tempoReal: z.number().int().nullable(),
    }),
  ),
  reservas: z.array(
    z.object({
      id: z.string().uuid(),
      pecaId: z.string().uuid(),
      nome: z.string(),
      quantidade: z.number().int(),
      precoUnitario: z.number(),
      status: z.enum(['RESERVADA', 'CONSUMIDA', 'LIBERADA']),
    }),
  ),
  historico: z.array(
    z.object({
      id: z.string().uuid(),
      statusAnterior: z.string().nullable(),
      statusNovo: z.string(),
      observacao: z.string().nullable(),
      criadoEm: z.date(),
    }),
  ),
});

export const listarFilaResponseSchema = z.object({
  data: z.array(execucaoResponseSchema),
  meta: metaSchema,
});
