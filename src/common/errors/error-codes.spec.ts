import { HttpStatus } from '@nestjs/common';
import { AppException, ErrorCode } from './error-codes';

describe('AppException', () => {
  it('carries a stable code and http status', () => {
    const ex = new AppException(
      ErrorCode.LISTING_NOT_FOUND,
      'Listing not found',
      HttpStatus.NOT_FOUND,
    );
    expect(ex.code).toBe('LISTING_NOT_FOUND');
    expect(ex.getStatus()).toBe(404);
    expect(ex.message).toBe('Listing not found');
  });
});
