import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrismaExecucaoRepository } from '../../../infrastructure/database/repositories/prisma-execucoes.repository';
import {
  PrismaPecaRepository,
  PrismaServicoRepository,
} from '../../../infrastructure/database/repositories/prisma-catalogo.repository';
import {
  AcoesDoMecanico,
  BuscarExecucaoUseCase,
  ListarFilaUseCase,
} from '../../../application/use-cases/execucoes/execucoes.use-cases';
import type { IRastreamento } from '../../../domain/services/rastreamento.interface';
import { exigirInterno } from '../middlewares/auth.middleware';
import { erroResponseSchema, paramsIdSchema } from '../schemas/comum.schema';
import {
  concluirDiagnosticoSchema,
  execucaoResponseSchema,
  finalizarReparoSchema,
  listarFilaResponseSchema,
  listarFilaSchema,
  ordemParamsSchema,
  registrarFalhaSchema,
} from '../schemas/execucoes.schema';

export const execucoesRoutes: FastifyPluginAsync<{ rastreamento: IRastreamento }> = async (
  instance,
  { rastreamento },
) => {
  const fastify = instance.withTypeProvider<ZodTypeProvider>();
  const repo = new PrismaExecucaoRepository();
  const servicos = new PrismaServicoRepository();
  const pecas = new PrismaPecaRepository();
  const tags = ['Fila de execução'];
  const security = [{ bearerAuth: [] }];
  const respostas = {
    200: execucaoResponseSchema,
    400: erroResponseSchema,
    404: erroResponseSchema,
    409: erroResponseSchema,
  };

  const listar = new ListarFilaUseCase(repo);
  const buscar = new BuscarExecucaoUseCase(repo);
  const acoes = (req: { log: AcoesDoMecanicoLogger }) =>
    new AcoesDoMecanico(repo, servicos, pecas, rastreamento, req.log);

  fastify.addHook('onRequest', exigirInterno);

  fastify.get(
    '/',
    {
      schema: {
        tags,
        security,
        summary: 'Fila de execução',
        description:
          'Sem filtro, mostra só o que está em andamento: primeiro o que está em reparo, depois em diagnóstico, aguardando reparo e na fila; dentro de cada grupo, a mais antiga primeiro.',
        querystring: listarFilaSchema,
        response: { 200: listarFilaResponseSchema },
      },
    },
    async (req, rep) => rep.send(await listar.execute(req.query)),
  );

  fastify.get(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Buscar execução',
        params: paramsIdSchema,
        response: respostas,
      },
    },
    async (req, rep) => rep.send(await buscar.porId(req.params.id)),
  );

  fastify.get(
    '/ordem/:ordemId',
    {
      schema: {
        tags,
        security,
        summary: 'Buscar execução pela OS',
        params: ordemParamsSchema,
        response: respostas,
      },
    },
    async (req, rep) => rep.send(await buscar.porOrdem(req.params.ordemId)),
  );

  fastify.post(
    '/:id/diagnostico/iniciar',
    {
      schema: {
        tags,
        security,
        summary: 'Iniciar diagnóstico',
        description:
          'Na fila → em diagnóstico. Avisa o OS Service, que muda a OS para Em Diagnóstico.',
        params: paramsIdSchema,
        response: respostas,
      },
    },
    async (req, rep) => rep.send(await acoes(req).iniciarDiagnostico(req.params.id)),
  );

  fastify.post(
    '/:id/diagnostico/concluir',
    {
      schema: {
        tags,
        security,
        summary: 'Concluir diagnóstico com os itens do orçamento',
        description:
          'Reserva as peças no estoque (falha com 400 se faltar) e envia os itens para o orçamento.',
        params: paramsIdSchema,
        body: concluirDiagnosticoSchema,
        response: respostas,
      },
    },
    async (req, rep) => rep.send(await acoes(req).concluirDiagnostico(req.params.id, req.body)),
  );

  fastify.post(
    '/:id/reparo/iniciar',
    {
      schema: {
        tags,
        security,
        summary: 'Iniciar reparo',
        description: 'Permitido depois do pagamento. Consome as peças reservadas.',
        params: paramsIdSchema,
        response: respostas,
      },
    },
    async (req, rep) => rep.send(await acoes(req).iniciarReparo(req.params.id)),
  );

  fastify.post(
    '/:id/reparo/finalizar',
    {
      schema: {
        tags,
        security,
        summary: 'Finalizar reparo',
        description: 'Sem tempoRealMin, usa o tempo desde o início do reparo.',
        params: paramsIdSchema,
        body: finalizarReparoSchema,
        response: respostas,
      },
    },
    async (req, rep) =>
      rep.send(await acoes(req).finalizarReparo(req.params.id, req.body.tempoRealMin)),
  );

  fastify.post(
    '/:id/falha',
    {
      schema: {
        tags,
        security,
        summary: 'Registrar falha na execução',
        description:
          'Encerra a execução, devolve peças ainda reservadas e dispara a compensação da saga (estorno do pagamento e cancelamento da OS).',
        params: paramsIdSchema,
        body: registrarFalhaSchema,
        response: respostas,
      },
    },
    async (req, rep) => rep.send(await acoes(req).registrarFalha(req.params.id, req.body.motivo)),
  );
};

type AcoesDoMecanicoLogger = ConstructorParameters<typeof AcoesDoMecanico>[4];
