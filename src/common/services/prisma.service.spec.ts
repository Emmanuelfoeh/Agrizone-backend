import { PrismaService } from './prisma.service';

describe('PrismaService soft-delete extension', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { phone: { startsWith: '+233-test-' } } });
    await prisma.onModuleDestroy();
  });

  it('connects and runs a trivial query', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
    expect(rows[0].ok).toBe(1);
  });

  it('hides soft-deleted User rows from db.user reads but base client still sees them', async () => {
    const phone = `+233-test-${Date.now()}`;
    const user = await prisma.user.create({ data: { phone, displayName: 'Soft Delete Test' } });

    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    const viaDb = await prisma.db.user.findFirst({ where: { id: user.id } });
    expect(viaDb).toBeNull();

    const viaBase = await prisma.user.findFirst({ where: { id: user.id } });
    expect(viaBase?.id).toBe(user.id);

    const explicit = await prisma.db.user.findFirst({ where: { id: user.id, deletedAt: { not: null } } });
    expect(explicit?.id).toBe(user.id);
  });
});
