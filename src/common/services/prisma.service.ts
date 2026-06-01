import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Models that carry a nullable `deletedAt`. Reads on these auto-filter to
// deletedAt: null unless a query explicitly passes deletedAt. Append-only tables
// (LedgerEntry, AuditLog) are NOT listed here. Models are added as later steps
// introduce them.
const SOFT_DELETE_MODELS = new Set<string>(['User', 'UserRole']);

// Local interface for the $allOperations callback parameters.
// We use an explicit shape here and cast the callback below because Prisma
// types $allModels as `never` when the schema contains no models (models are
// added in a later migration step). Once real models exist the cast becomes
// unnecessary from a correctness standpoint, but it is harmless and keeps the
// runtime soft-delete logic intact throughout.
interface AllOperationsCbParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

type AnyAllOperationsCb = (params: AllOperationsCbParams) => Promise<unknown>;

function softDeleteExtension(client: PrismaClient) {
  // Cast is required because Prisma types $allModels/$allOperations as `never`
  // when the schema has no models. The runtime logic is correct and will work
  // transparently once models are added.
  const allOperationsCb: AnyAllOperationsCb = async ({
    model,
    operation,
    args,
    query,
  }) => {
    const isRead =
      operation === 'findFirst' ||
      operation === 'findMany' ||
      operation === 'findUnique';
    if (model && SOFT_DELETE_MODELS.has(model) && isRead) {
      const a = (args ?? {}) as { where?: Record<string, unknown> };
      if (!a.where || !('deletedAt' in a.where)) {
        a.where = { ...(a.where ?? {}), deletedAt: null };
      }
      return query(a);
    }
    return query(args);
  };

  return client.$extends({
    query: {
      $allModels: {
        $allOperations: allOperationsCb as any,
      },
    },
  });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
