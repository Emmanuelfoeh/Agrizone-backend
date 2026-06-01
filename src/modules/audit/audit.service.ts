import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditRepository } from './audit.repository';

export interface AuditRecord {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditRepository) {}

  /** Fire-and-forget audit write; never throws into the caller. */
  async record(rec: AuditRecord): Promise<void> {
    try {
      await this.repo.create({
        actorUserId: rec.actorUserId ?? null,
        action: rec.action,
        entityType: rec.entityType,
        entityId: rec.entityId ?? null,
        ip: rec.ip ?? null,
        userAgent: rec.userAgent ?? null,
        correlationId: rec.correlationId ?? null,
        before:
          rec.before === undefined
            ? Prisma.JsonNull
            : (rec.before as Prisma.InputJsonValue),
        after:
          rec.after === undefined
            ? Prisma.JsonNull
            : (rec.after as Prisma.InputJsonValue),
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for ${rec.action}`,
        err as Error,
      );
    }
  }
}
