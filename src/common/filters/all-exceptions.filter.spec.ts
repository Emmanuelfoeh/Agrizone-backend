import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException, ErrorCode } from '../errors/error-codes';

function mockHost(): {
  host: ArgumentsHost;
  payload: () => unknown;
  status: () => number;
} {
  let body: unknown;
  let code = 0;
  const res = {
    status(s: number) {
      code = s;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  };
  const req = { correlationId: 'CID-123', url: '/v1/x', method: 'GET' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, payload: () => body, status: () => code };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('renders AppException with its code and the correlation id', () => {
    const m = mockHost();
    filter.catch(
      new AppException(
        ErrorCode.LISTING_NOT_FOUND,
        'Listing not found',
        HttpStatus.NOT_FOUND,
      ),
      m.host,
    );
    expect(m.status()).toBe(404);
    expect(m.payload()).toEqual({
      error: {
        code: 'LISTING_NOT_FOUND',
        message: 'Listing not found',
        correlationId: 'CID-123',
      },
    });
  });

  it('maps a built-in NotFoundException to NOT_FOUND code', () => {
    const m = mockHost();
    filter.catch(new NotFoundException('nope'), m.host);
    expect(m.status()).toBe(404);
    expect((m.payload() as { error: { code: string } }).error.code).toBe(
      'NOT_FOUND',
    );
  });

  it('renders unknown errors as INTERNAL 500', () => {
    const m = mockHost();
    filter.catch(new Error('boom'), m.host);
    expect(m.status()).toBe(500);
    expect((m.payload() as { error: { code: string } }).error.code).toBe(
      'INTERNAL',
    );
  });
});
