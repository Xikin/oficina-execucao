import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { AppError } from './shared/errors';
import { TransicaoInvalidaError } from './domain/execucao/execucao';
import {
  EstoqueInsuficienteError,
  ExecucaoAlteradaError,
} from './domain/repositories/execucoes.repository.interface';
import {
  rastreamentoDesligado,
  type IRastreamento,
} from './domain/services/rastreamento.interface';
import { pecasRoutes, servicosRoutes } from './presentation/http/routes/catalogo.routes';
import { execucoesRoutes } from './presentation/http/routes/execucoes.routes';

export interface Dependencias {
  rastreamento: IRastreamento;
  mensageria: { readonly conectado: boolean } | null;
}

function responder(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  req.log.warn(
    {
      evento: 'erro_negocio',
      codigo: code,
      statusCode,
      rota: req.routeOptions?.url,
      mensagem: message,
    },
    'requisição rejeitada',
  );
  return reply.status(statusCode).send({ statusCode, code, message });
}

export async function buildApp(deps: Partial<Dependencias> = {}): Promise<FastifyInstance> {
  const rastreamento = deps.rastreamento ?? rastreamentoDesligado;
  const mensageria = deps.mensageria ?? null;

  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            base: {
              service: 'oficina-execucao',
              env: env.NODE_ENV,
              version: process.env.APP_VERSION ?? 'dev',
            },
            redact: { paths: ['req.headers.authorization'], censor: '[REDACTED]' },
          },
    genReqId(req) {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && header.length > 0 && header.length <= 200) return header;
      return randomUUID();
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    return payload;
  });

  const origens = env.ALLOWED_ORIGINS.split(',').filter(Boolean);
  await app.register(fastifyCors, {
    origin: origens.length > 0 ? origens : env.NODE_ENV !== 'production',
    exposedHeaders: ['x-request-id'],
  });
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  if (env.SWAGGER_ENABLED) {
    await app.register(fastifySwagger, {
      transform: jsonSchemaTransform,
      openapi: {
        info: {
          title: 'Oficina Mecânica — Execução e Produção',
          version: '1.0.0',
          description:
            'Fila de diagnóstico e reparo, catálogo de serviços e estoque de peças. Participa da saga de atendimento recebendo comandos e publicando eventos no RabbitMQ.',
        },
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
        tags: [
          { name: 'Fila de execução' },
          { name: 'Catálogo de serviços' },
          { name: 'Estoque de peças' },
          { name: 'Saúde' },
        ],
      },
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  }

  app.setErrorHandler((error, req, reply) => {
    if (error.validation)
      return reply.status(422).send({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        errors: error.validation,
      });
    if (error instanceof ZodError)
      return reply.status(422).send({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        errors: error.flatten().fieldErrors,
      });
    if (error instanceof AppError)
      return responder(req, reply, error.statusCode, error.code, error.message);
    if (error instanceof TransicaoInvalidaError)
      return responder(req, reply, 400, 'BUSINESS_ERROR', error.message);
    if (error instanceof EstoqueInsuficienteError)
      return responder(req, reply, 400, 'STOCK_ERROR', error.message);
    if (error instanceof ExecucaoAlteradaError)
      return responder(req, reply, 409, 'CONFLICT', error.message);
    if (error.code === 'P2002') return responder(req, reply, 409, 'CONFLICT', 'Registro duplicado');

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return responder(req, reply, error.statusCode, error.code ?? 'BAD_REQUEST', error.message);

    req.log.error(
      { evento: 'erro_interno', rota: req.routeOptions?.url, err: error },
      'erro não tratado ao processar requisição',
    );
    return reply
      .status(500)
      .send({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' });
  });

  app.get('/health', { schema: { tags: ['Saúde'], summary: 'Liveness' } }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.get(
    '/health/ready',
    { schema: { tags: ['Saúde'], summary: 'Readiness — banco acessível' } },
    async (req, rep) => {
      const inicio = Date.now();
      const mensageriaStatus = mensageria
        ? mensageria.conectado
          ? 'ok'
          : 'reconectando'
        : 'desligada';
      try {
        await prisma.$queryRaw`SELECT 1`;
        return rep.send({
          status: 'ok',
          dependencias: { database: 'ok', mensageria: mensageriaStatus },
          latenciaMs: Date.now() - inicio,
        });
      } catch (erro) {
        req.log.error({ evento: 'readiness_falhou', err: erro }, 'banco de dados inacessível');
        return rep.status(503).send({
          status: 'degradado',
          dependencias: { database: 'indisponivel', mensageria: mensageriaStatus },
          latenciaMs: Date.now() - inicio,
        });
      }
    },
  );

  app.register(execucoesRoutes, { prefix: '/execucoes', rastreamento });
  app.register(servicosRoutes, { prefix: '/servicos' });
  app.register(pecasRoutes, { prefix: '/pecas' });

  return app;
}
