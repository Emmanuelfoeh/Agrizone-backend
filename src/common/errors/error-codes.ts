import { HttpException, HttpStatus } from '@nestjs/common';

// Stable codes the frontend branches on (spec §3.5). Grows as modules are added.
export enum ErrorCode {
  INTERNAL = 'INTERNAL',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TIER_TOO_LOW = 'TIER_TOO_LOW',
  LISTING_NOT_FOUND = 'LISTING_NOT_FOUND',
  OTP_INVALID = 'OTP_INVALID',
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_THROTTLED = 'OTP_THROTTLED',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  REFRESH_INVALID = 'REFRESH_INVALID',
  PHONE_INVALID = 'PHONE_INVALID',
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
