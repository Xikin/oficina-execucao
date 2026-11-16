import { PrismaClient } from '@prisma/client';
import { semearCatalogo } from '../src/seed';

const prisma = new PrismaClient();

semearCatalogo(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
