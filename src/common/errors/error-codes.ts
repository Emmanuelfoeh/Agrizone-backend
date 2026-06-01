import { HttpException, HttpStatus } from '@nestjs/common';

// Stable codes the frontend branches on (spec §3.5). Grows as modules are added.
export enum ErrorCode {
  INTERNAL = 'INTERNAL',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TIER_TOO_LOW = 'TIER_TOO_LOW',
  LISTING_NOT_FOUND = 'LISTING_NOT_FOUND',
}

export class AppException extends HttpException {
  readonly code: ErrorCode;
  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status);
    this.code = code;
  }
}
