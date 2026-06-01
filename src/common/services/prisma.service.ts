import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Models that carry a nullable `deletedAt`. Reads on these auto-filter to
// deletedAt: null unless a query explicitly passes deletedAt. Append-only tables
// (LedgerEntry, AuditLog) are NOT listed here. Models are added as later steps
// introduce them.
const SOFT_DELETE_MODELS = new Set<string>([]);

function softDeleteExtension(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isRead = operation === 'findFirst' || operation === 'findMany' || operation === 'findUnique';
          if (model && SOFT_DELETE_MODELS.has(model) && isRead) {
            const a = (args ?? {}) as { where?: Record<string, unknown> };
            if (!a.where || !('deletedAt' in a.where)) {
              a.where = { ...(a.where ?? {}), deletedAt: null };
            }
            return query(a);
          }
          return query(args);
        },
      },
    },
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** The soft-delete-extended client. Repositories use this. */
  readonly db: ReturnType<typeof softDeleteExtension>;

  constructor() {
    super();
    this.db = softDeleteExtension(this);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
