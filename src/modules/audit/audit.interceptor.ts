import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser; correlationId?: string }>();
    if (!MUTATING.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        void this.audit.record({
          actorUserId: req.user?.id,
          action: `${req.method} ${req.route?.path ?? req.url}`,
          entityType: 'http',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          correlationId: req.correlationId,
        });
      }),
    );
  }
}
