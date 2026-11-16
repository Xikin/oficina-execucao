import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';
import { EXEC_ID, ORDEM_ID, PECA_ID, SERVICO_ID } from '../fixtures';

let app: FastifyInstance;
let interno: string;
let cliente: string;

const usarMockComoTransacao = () =>
  vi
    .mocked(prisma.$transaction)
    .mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);

const linha = (status: string) => ({
  id: EXEC_ID,
  ordemId: ORDEM_ID,
  sagaId: 'saga',
  numeroOS: 5,
  status,
  descricao: null,
  veiculoPlaca: 'ABC1D23',
  veiculoMarca: 'VW',
  veiculoModelo: 'Gol',
  veiculoAno: 2019,
  observacaoDiagnostico: null,
  motivoEncerramento: null,
  tempoRealMin: null,
  diagnosticoIniciadoEm: null,
  diagnosticadaEm: null,
  liberadaEm: null,
  reparoIniciadoEm: null,
  finalizadaEm: null,
  encerradaEm: null,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  servicos: [],
  reservas: [],
  historico: [],
});

const servicoLinha = {
  id: SERVICO_ID,
  nome: 'Óleo',
  descricao: null,
  preco: 90,
  tempoPrevisto: 30,
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
};

const pecaLinha = {
  id: PECA_ID,
  nome: 'Filtro',
  descricao: null,
  preco: 20,
  quantidade: 2,
  estoqueMin: 5,
  unidade: 'un',
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
};

beforeAll(async () => {
  app = await buildApp({ mensageria: { conectado: true } });
  await app.ready();
  interno = app.jwt.sign({ sub: 'u', role: 'FUNCIONARIO', iss: 'oficina-api' });
  cliente = app.jwt.sign({ sub: 'c', role: 'CLIENTE', iss: 'oficina-auth-lambda' });
});

afterAll(() => app.close());

const comoInterno = () => ({ authorization: `Bearer ${interno}` });

describe('autenticação', () => {
  it('401 sem token e 403 para token de cliente', async () => {
    expect((await app.inject({ method: 'GET', url: '/execucoes' })).statusCode).toBe(401);
    const res = await app.inject({
      method: 'GET',
      url: '/pecas',
      headers: { authorization: `Bearer ${cliente}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('fila de execução', () => {
  it('lista e busca por OS', async () => {
    vi.mocked(prisma.execucao.findMany).mockResolvedValue([linha('NA_FILA')] as never);
    vi.mocked(prisma.execucao.count).mockResolvedValue(1 as never);
    const lista = await app.inject({ method: 'GET', url: '/execucoes', headers: comoInterno() });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().data[0].numeroOS).toBe(5);

    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('NA_FILA') as never);
    const porOrdem = await app.inject({
      method: 'GET',
      url: `/execucoes/ordem/${ORDEM_ID}`,
      headers: comoInterno(),
    });
    expect(porOrdem.statusCode).toBe(200);
    const porId = await app.inject({
      method: 'GET',
      url: `/execucoes/${EXEC_ID}`,
      headers: comoInterno(),
    });
    expect(porId.statusCode).toBe(200);
  });

  it('iniciar diagnóstico grava o evento no outbox', async () => {
    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('NA_FILA') as never);
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.execucao.findUniqueOrThrow).mockResolvedValue(
      linha('EM_DIAGNOSTICO') as never,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/diagnostico/iniciar`,
      headers: comoInterno(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('EM_DIAGNOSTICO');
    const outbox = vi.mocked(prisma.outbox.createMany).mock.calls[0][0] as {
      data: { routingKey: string }[];
    };
    expect(outbox.data[0].routingKey).toBe('execucao.evento.diagnostico-iniciado');
  });

  it('400 para transição inválida e 409 para alteração concorrente', async () => {
    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('DIAGNOSTICADA') as never);
    const invalida = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/reparo/iniciar`,
      headers: comoInterno(),
    });
    expect(invalida.statusCode).toBe(400);
    expect(invalida.json().code).toBe('BUSINESS_ERROR');

    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('AGUARDANDO_REPARO') as never);
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 0 } as never);
    const concorrente = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/reparo/iniciar`,
      headers: comoInterno(),
    });
    expect(concorrente.statusCode).toBe(409);
  });

  it('400 STOCK_ERROR quando falta peça na conclusão do diagnóstico', async () => {
    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('EM_DIAGNOSTICO') as never);
    vi.mocked(prisma.peca.findMany).mockResolvedValue([pecaLinha] as never);
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.peca.updateMany).mockResolvedValue({ count: 0 } as never);
    const res = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/diagnostico/concluir`,
      headers: comoInterno(),
      payload: { pecas: [{ pecaId: PECA_ID, quantidade: 50 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('STOCK_ERROR');
  });

  it('finalizar e registrar falha validam o corpo', async () => {
    const falha = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/falha`,
      headers: comoInterno(),
      payload: { motivo: 'x' },
    });
    expect(falha.statusCode).toBe(422);

    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('EM_REPARO') as never);
    usarMockComoTransacao();
    vi.mocked(prisma.execucao.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.execucao.findUniqueOrThrow).mockResolvedValue(linha('FINALIZADA') as never);
    const fim = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/reparo/finalizar`,
      headers: comoInterno(),
      payload: { tempoRealMin: 40 },
    });
    expect(fim.statusCode).toBe(200);

    vi.mocked(prisma.execucao.findUnique).mockResolvedValue(linha('EM_REPARO') as never);
    vi.mocked(prisma.execucao.findUniqueOrThrow).mockResolvedValue(linha('FALHOU') as never);
    vi.mocked(prisma.reservaPeca.findMany).mockResolvedValue([] as never);
    const falhou = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/falha`,
      headers: comoInterno(),
      payload: { motivo: 'Peça incompatível' },
    });
    expect(falhou.json().status).toBe('FALHOU');
  });
});

describe('catálogo', () => {
  it('serviços: cria, lista, busca, tempo médio, atualiza e remove', async () => {
    vi.mocked(prisma.servico.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.servico.create).mockResolvedValue(servicoLinha as never);
    const criado = await app.inject({
      method: 'POST',
      url: '/servicos',
      headers: comoInterno(),
      payload: { nome: 'Óleo', preco: 90 },
    });
    expect(criado.statusCode).toBe(201);

    vi.mocked(prisma.servico.findMany).mockResolvedValue([servicoLinha] as never);
    vi.mocked(prisma.servico.count).mockResolvedValue(1 as never);
    expect(
      (await app.inject({ method: 'GET', url: '/servicos?busca=ól', headers: comoInterno() }))
        .statusCode,
    ).toBe(200);

    vi.mocked(prisma.servico.findFirst).mockResolvedValue(servicoLinha as never);
    expect(
      (await app.inject({ method: 'GET', url: `/servicos/${SERVICO_ID}`, headers: comoInterno() }))
        .statusCode,
    ).toBe(200);

    vi.mocked(prisma.itemServicoExecucao.findMany).mockResolvedValue([] as never);
    const tempo = await app.inject({
      method: 'GET',
      url: `/servicos/${SERVICO_ID}/tempo-medio`,
      headers: comoInterno(),
    });
    expect(tempo.json()).toEqual({ tempoMedio: null, totalExecucoes: 0 });

    vi.mocked(prisma.servico.findFirst)
      .mockResolvedValueOnce(servicoLinha as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.servico.update).mockResolvedValue(servicoLinha as never);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/servicos/${SERVICO_ID}`,
          headers: comoInterno(),
          payload: { nome: 'Óleo sintético' },
        })
      ).statusCode,
    ).toBe(200);

    vi.mocked(prisma.servico.findFirst).mockResolvedValue(servicoLinha as never);
    vi.mocked(prisma.itemServicoExecucao.findFirst).mockResolvedValue(null);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/servicos/${SERVICO_ID}`,
          headers: comoInterno(),
        })
      ).statusCode,
    ).toBe(204);
  });

  it('peças: cria, lista, alertas, busca, atualiza, ajusta e remove', async () => {
    vi.mocked(prisma.peca.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.peca.create).mockResolvedValue(pecaLinha as never);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/pecas',
          headers: comoInterno(),
          payload: { nome: 'Filtro', preco: 20 },
        })
      ).statusCode,
    ).toBe(201);

    vi.mocked(prisma.peca.findMany).mockResolvedValue([pecaLinha] as never);
    vi.mocked(prisma.peca.count).mockResolvedValue(1 as never);
    const lista = await app.inject({ method: 'GET', url: '/pecas', headers: comoInterno() });
    expect(lista.json().data[0].estoqueBaixo).toBe(true);
    const alertas = await app.inject({
      method: 'GET',
      url: '/pecas/alertas-estoque',
      headers: comoInterno(),
    });
    expect(alertas.json()[0].deficit).toBe(3);

    vi.mocked(prisma.peca.findFirst).mockResolvedValue(pecaLinha as never);
    expect(
      (await app.inject({ method: 'GET', url: `/pecas/${PECA_ID}`, headers: comoInterno() }))
        .statusCode,
    ).toBe(200);

    vi.mocked(prisma.peca.update).mockResolvedValue(pecaLinha as never);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/pecas/${PECA_ID}`,
          headers: comoInterno(),
          payload: { preco: 22 },
        })
      ).statusCode,
    ).toBe(200);

    vi.mocked(prisma.peca.updateMany).mockResolvedValue({ count: 0 } as never);
    const semSaldo = await app.inject({
      method: 'PATCH',
      url: `/pecas/${PECA_ID}/estoque`,
      headers: comoInterno(),
      payload: { quantidade: -10 },
    });
    expect(semSaldo.statusCode).toBe(400);

    expect(
      (await app.inject({ method: 'DELETE', url: `/pecas/${PECA_ID}`, headers: comoInterno() }))
        .statusCode,
    ).toBe(204);
  });

  it('409 em nome duplicado vindo do banco', async () => {
    vi.mocked(prisma.peca.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.peca.create).mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/pecas',
      headers: comoInterno(),
      payload: { nome: 'Filtro', preco: 20 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('500 genérico para erro inesperado', async () => {
    vi.mocked(prisma.peca.findMany).mockRejectedValue(new Error('conexão perdida'));
    const res = await app.inject({ method: 'GET', url: '/pecas', headers: comoInterno() });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('INTERNAL_ERROR');
  });
});

describe('saúde', () => {
  it('liveness e readiness', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    const pronto = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(pronto.json().dependencias).toEqual({ database: 'ok', mensageria: 'ok' });
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('fora'));
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
  });
});

describe('erros do próprio Fastify', () => {
  it('corpo JSON vazio devolve 400, não 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/execucoes/${EXEC_ID}/diagnostico/iniciar`,
      headers: { ...comoInterno(), 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FST_ERR_CTP_EMPTY_JSON_BODY');
  });
});
