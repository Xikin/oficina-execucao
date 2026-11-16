import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PrismaPecaRepository,
  PrismaServicoRepository,
} from '../../../infrastructure/database/repositories/prisma-catalogo.repository';
import * as S from '../../../application/use-cases/servicos/servicos.use-cases';
import * as P from '../../../application/use-cases/pecas/pecas.use-cases';
import { exigirInterno } from '../middlewares/auth.middleware';
import { erroResponseSchema, paramsIdSchema } from '../schemas/comum.schema';
import {
  ajustarEstoqueSchema,
  alertaEstoqueSchema,
  atualizarPecaSchema,
  atualizarServicoSchema,
  criarPecaSchema,
  criarServicoSchema,
  listarCatalogoSchema,
  listarPecasResponseSchema,
  listarServicosResponseSchema,
  pecaResponseSchema,
  servicoResponseSchema,
  tempoMedioResponseSchema,
} from '../schemas/catalogo.schema';

const security = [{ bearerAuth: [] }];

export const servicosRoutes: FastifyPluginAsync = async (instance) => {
  const fastify = instance.withTypeProvider<ZodTypeProvider>();
  const repo = new PrismaServicoRepository();
  const tags = ['Catálogo de serviços'];

  fastify.addHook('onRequest', exigirInterno);

  fastify.post(
    '/',
    {
      schema: {
        tags,
        security,
        summary: 'Cadastrar serviço',
        body: criarServicoSchema,
        response: { 201: servicoResponseSchema, 409: erroResponseSchema },
      },
    },
    async (req, rep) =>
      rep.status(201).send(await new S.CriarServicoUseCase(repo).execute(req.body)),
  );

  fastify.get(
    '/',
    {
      schema: {
        tags,
        security,
        summary: 'Listar serviços',
        querystring: listarCatalogoSchema,
        response: { 200: listarServicosResponseSchema },
      },
    },
    async (req, rep) => rep.send(await new S.ListarServicosUseCase(repo).execute(req.query)),
  );

  fastify.get(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Buscar serviço',
        params: paramsIdSchema,
        response: { 200: servicoResponseSchema, 404: erroResponseSchema },
      },
    },
    async (req, rep) =>
      rep.send(await new S.BuscarServicoPorIdUseCase(repo).execute(req.params.id)),
  );

  fastify.get(
    '/:id/tempo-medio',
    {
      schema: {
        tags,
        security,
        summary: 'Tempo médio real de execução do serviço',
        params: paramsIdSchema,
        response: { 200: tempoMedioResponseSchema, 404: erroResponseSchema },
      },
    },
    async (req, rep) =>
      rep.send(await new S.CalcularTempoMedioUseCase(repo).execute(req.params.id)),
  );

  fastify.put(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Atualizar serviço',
        params: paramsIdSchema,
        body: atualizarServicoSchema,
        response: { 200: servicoResponseSchema, 404: erroResponseSchema, 409: erroResponseSchema },
      },
    },
    async (req, rep) =>
      rep.send(await new S.AtualizarServicoUseCase(repo).execute(req.params.id, req.body)),
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Desativar serviço',
        params: paramsIdSchema,
        response: { 204: z.void(), 400: erroResponseSchema, 404: erroResponseSchema },
      },
    },
    async (req, rep) => {
      await new S.RemoverServicoUseCase(repo).execute(req.params.id);
      return rep.status(204).send();
    },
  );
};

export const pecasRoutes: FastifyPluginAsync = async (instance) => {
  const fastify = instance.withTypeProvider<ZodTypeProvider>();
  const repo = new PrismaPecaRepository();
  const tags = ['Estoque de peças'];

  fastify.addHook('onRequest', exigirInterno);

  fastify.post(
    '/',
    {
      schema: {
        tags,
        security,
        summary: 'Cadastrar peça',
        body: criarPecaSchema,
        response: { 201: pecaResponseSchema, 409: erroResponseSchema },
      },
    },
    async (req, rep) => rep.status(201).send(await new P.CriarPecaUseCase(repo).execute(req.body)),
  );

  fastify.get(
    '/',
    {
      schema: {
        tags,
        security,
        summary: 'Listar peças',
        querystring: listarCatalogoSchema,
        response: { 200: listarPecasResponseSchema },
      },
    },
    async (req, rep) => rep.send(await new P.ListarPecasUseCase(repo).execute(req.query)),
  );

  fastify.get(
    '/alertas-estoque',
    {
      schema: {
        tags,
        security,
        summary: 'Peças no estoque mínimo ou abaixo dele',
        response: { 200: z.array(alertaEstoqueSchema) },
      },
    },
    async (_req, rep) => rep.send(await new P.AlertasEstoqueUseCase(repo).execute()),
  );

  fastify.get(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Buscar peça',
        params: paramsIdSchema,
        response: { 200: pecaResponseSchema, 404: erroResponseSchema },
      },
    },
    async (req, rep) => rep.send(await new P.BuscarPecaPorIdUseCase(repo).execute(req.params.id)),
  );

  fastify.put(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Atualizar peça (o estoque muda só pelo ajuste)',
        params: paramsIdSchema,
        body: atualizarPecaSchema,
        response: { 200: pecaResponseSchema, 404: erroResponseSchema, 409: erroResponseSchema },
      },
    },
    async (req, rep) =>
      rep.send(await new P.AtualizarPecaUseCase(repo).execute(req.params.id, req.body)),
  );

  fastify.patch(
    '/:id/estoque',
    {
      schema: {
        tags,
        security,
        summary: 'Ajustar estoque',
        description:
          'Valor positivo para entrada, negativo para saída. Nunca deixa o saldo negativo.',
        params: paramsIdSchema,
        body: ajustarEstoqueSchema,
        response: { 200: pecaResponseSchema, 400: erroResponseSchema, 404: erroResponseSchema },
      },
    },
    async (req, rep) =>
      rep.send(await new P.AjustarEstoqueUseCase(repo).execute(req.params.id, req.body.quantidade)),
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Desativar peça',
        params: paramsIdSchema,
        response: { 204: z.void(), 404: erroResponseSchema },
      },
    },
    async (req, rep) => {
      await new P.RemoverPecaUseCase(repo).execute(req.params.id);
      return rep.status(204).send();
    },
  );
};
