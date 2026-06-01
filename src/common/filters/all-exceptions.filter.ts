import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/error-codes';

interface RequestWithCorrelation {
  correlationId?: string;
  url?: string;
  method?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{
      status: (n: number) => { json: (b: unknown) => unknown };
    }>();
    const req = http.getRequest<RequestWithCorrelation>();
    const correlationId = req.correlationId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL;
    let message = 'Internal server error';

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? ErrorCode.INTERNAL; // e.g. NOT_FOUND
      const r = exception.getResponse();
      message =
        typeof r === 'string'
          ? r
          : ((r as { message?: string }).message ?? exception.message);
    }

    res.status(status).json({ error: { code, message, correlationId } });
  }
}
