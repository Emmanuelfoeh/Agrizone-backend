import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

interface Req {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
}
interface Res {
  setHeader: (k: string, v: string) => void;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Req, res: Res, next: () => void): void {
    const inbound = req.headers['x-correlation-id'];
    const id = (typeof inbound === 'string' && inbound) || randomUUID();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}
