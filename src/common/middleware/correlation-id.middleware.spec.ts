import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  const mw = new CorrelationIdMiddleware();

  it('reuses an inbound x-correlation-id header', () => {
    const req = { headers: { 'x-correlation-id': 'CID-in' } } as never as {
      correlationId?: string;
    };
    const setHeader = jest.fn();
    const next = jest.fn();
    mw.use(req as never, { setHeader }, next);
    expect(req.correlationId).toBe('CID-in');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'CID-in');
    expect(next).toHaveBeenCalled();
  });

  it('generates one when absent', () => {
    const req = { headers: {} } as never as { correlationId?: string };
    const next = jest.fn();
    mw.use(req as never, { setHeader: jest.fn() }, next);
    expect(req.correlationId).toMatch(/.{10,}/);
    expect(next).toHaveBeenCalled();
  });
});
