import { z } from 'zod';
import { metaSchema, paginacaoSchema } from './comum.schema';

export const criarServicoSchema = z.object({
  nome: z.string().min(2).max(200),
  descricao: z.string().max(1000).optional(),
  preco: z.number().positive(),
  tempoPrevisto: z.number().int().positive().optional(),
});

export const atualizarServicoSchema = criarServicoSchema.partial();

export const listarCatalogoSchema = paginacaoSchema.extend({ busca: z.string().optional() });

export const servicoResponseSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  descricao: z.string().nullish(),
  preco: z.number(),
  tempoPrevisto: z.number().int().nullable(),
  ativo: z.boolean(),
  criadoEm: z.date(),
  atualizadoEm: z.date(),
});

export const listarServicosResponseSchema = z.object({
  data: z.array(servicoResponseSchema),
  meta: metaSchema,
});

export const tempoMedioResponseSchema = z.object({
  tempoMedio: z.number().int().nullable(),
  totalExecucoes: z.number().int(),
});

export const criarPecaSchema = z.object({
  nome: z.string().min(2).max(200),
  descricao: z.string().max(1000).optional(),
  preco: z.number().positive(),
  quantidade: z.number().int().min(0).default(0),
  estoqueMin: z.number().int().min(0).default(0),
  unidade: z.string().max(10).default('un'),
});

export const atualizarPecaSchema = criarPecaSchema.omit({ quantidade: true }).partial();

export const ajustarEstoqueSchema = z.object({
  quantidade: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Informe uma quantidade diferente de zero'),
  motivo: z.string().max(200).optional(),
});

export const pecaResponseSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  descricao: z.string().nullish(),
  preco: z.number(),
  quantidade: z.number().int(),
  estoqueMin: z.number().int(),
  unidade: z.string(),
  ativo: z.boolean(),
  criadoEm: z.date(),
  atualizadoEm: z.date(),
});

export const listarPecasResponseSchema = z.object({
  data: z.array(pecaResponseSchema.extend({ estoqueBaixo: z.boolean() })),
  meta: metaSchema,
});

export const alertaEstoqueSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  quantidade: z.number().int(),
  estoqueMin: z.number().int(),
  unidade: z.string(),
  deficit: z.number().int(),
});
