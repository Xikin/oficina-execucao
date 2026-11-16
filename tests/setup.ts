import { vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key-min-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

const modelo = () => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  count: vi.fn(),
});

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(), Prisma: { Decimal: Number } }));

vi.mock('../src/config/prisma', () => ({
  prisma: {
    servico: modelo(),
    peca: modelo(),
    execucao: modelo(),
    itemServicoExecucao: modelo(),
    reservaPeca: modelo(),
    historicoExecucao: modelo(),
    outbox: modelo(),
    mensagemProcessada: modelo(),
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

beforeEach(() => vi.resetAllMocks());
