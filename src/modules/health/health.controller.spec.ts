import { Test } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaService } from '../../common/services/prisma.service';

describe('HealthController', () => {
  it('aggregates db + redis indicators to ok', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: async (fns: Array<() => Promise<unknown>>) => {
              await Promise.all(fns.map((f) => f()));
              return { status: 'ok', info: {}, error: {}, details: {} };
            },
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'redis://localhost:6379' },
        },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.check();
    expect(result.status).toBe('ok');
  });
});
