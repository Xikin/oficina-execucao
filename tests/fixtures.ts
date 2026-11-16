import { vi } from 'vitest';
import type {
  ExecucaoRecord,
  IExecucaoRepository,
} from '../src/domain/repositories/execucoes.repository.interface';
import type { IServicoRepository } from '../src/domain/repositories/servicos.repository.interface';
import type { IPecaRepository } from '../src/domain/repositories/pecas.repository.interface';
import type { Mensagem } from '../src/domain/mensageria/mensagem';

export const ORDEM_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';
export const EXEC_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
export const SERVICO_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
export const PECA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

export const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
export const rastreamento = { cabecalhosDePropagacao: () => ({ traceparent: 'tp' }) };

export function execucao(sobrescrever: Partial<ExecucaoRecord> = {}): ExecucaoRecord {
  return {
    id: EXEC_ID,
    ordemId: ORDEM_ID,
    sagaId: 'saga-1',
    numeroOS: 42,
    status: 'NA_FILA',
    descricao: 'Barulho',
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
    criadoEm: new Date(Date.now() - 60_000),
    atualizadoEm: new Date(),
    servicos: [],
    reservas: [],
    historico: [],
    ...sobrescrever,
  };
}

export function mensagem(tipo: string, dados: Record<string, unknown>): Mensagem {
  return {
    id: 'cmd-1',
    tipo,
    versao: 1,
    sagaId: 'saga-1',
    ordemId: ORDEM_ID,
    causadaPor: null,
    origem: 'oficina-os',
    ocorridaEm: new Date().toISOString(),
    dados,
  };
}

export const repoExecucoes = () =>
  ({
    buscarPorId: vi.fn(),
    buscarPorOrdem: vi.fn(),
    listar: vi.fn(),
    criar: vi.fn(),
    transicionar: vi.fn(),
    jaProcessada: vi.fn().mockResolvedValue(false),
    registrarProcessada: vi.fn(),
  }) as unknown as IExecucaoRepository;

export const repoServicos = () =>
  ({
    criar: vi.fn(),
    buscarPorId: vi.fn(),
    buscarVarios: vi.fn(),
    buscarPorNome: vi.fn(),
    listar: vi.fn(),
    atualizar: vi.fn(),
    remover: vi.fn(),
    emExecucaoAtiva: vi.fn(),
    temposReais: vi.fn(),
  }) as unknown as IServicoRepository;

export const repoPecas = () =>
  ({
    criar: vi.fn(),
    buscarPorId: vi.fn(),
    buscarVarias: vi.fn(),
    buscarPorNome: vi.fn(),
    listar: vi.fn(),
    listarTodas: vi.fn(),
    atualizar: vi.fn(),
    ajustarEstoque: vi.fn(),
    remover: vi.fn(),
  }) as unknown as IPecaRepository;
