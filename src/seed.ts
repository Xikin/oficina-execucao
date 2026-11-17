import { PrismaClient } from '@prisma/client';

const servicos = [
  { nome: 'Troca de Óleo', preco: 89.9, tempoPrevisto: 30 },
  { nome: 'Alinhamento e Balanceamento', preco: 120.0, tempoPrevisto: 60 },
  { nome: 'Revisão Geral', preco: 350.0, tempoPrevisto: 240 },
  { nome: 'Troca de Pastilha de Freio', preco: 200.0, tempoPrevisto: 90 },
  { nome: 'Diagnóstico Eletrônico', preco: 80.0, tempoPrevisto: 30 },
];

const pecas = [
  { nome: 'Óleo Motor 5W30', preco: 28.0, quantidade: 50, estoqueMin: 10, unidade: 'L' },
  { nome: 'Filtro de Óleo', preco: 22.0, quantidade: 30, estoqueMin: 5, unidade: 'un' },
  {
    nome: 'Pastilha de Freio Dianteira',
    preco: 85.0,
    quantidade: 15,
    estoqueMin: 3,
    unidade: 'jg',
  },
  { nome: 'Filtro de Ar', preco: 45.0, quantidade: 20, estoqueMin: 5, unidade: 'un' },
  { nome: 'Vela de Ignição NGK', preco: 35.0, quantidade: 40, estoqueMin: 8, unidade: 'un' },
];

export async function semearCatalogo(prisma: PrismaClient) {
  for (const s of servicos)
    if (!(await prisma.servico.findFirst({ where: { nome: s.nome } })))
      await prisma.servico.create({ data: s });

  for (const p of pecas)
    if (!(await prisma.peca.findFirst({ where: { nome: p.nome } })))
      await prisma.peca.create({ data: p });

  console.log(`Catálogo pronto: ${servicos.length} serviços e ${pecas.length} peças.`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  semearCatalogo(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
