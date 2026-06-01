import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('connects and runs a trivial query', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const rows =
      await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
    expect(rows[0].ok).toBe(1);
    await prisma.onModuleDestroy();
  });
});
