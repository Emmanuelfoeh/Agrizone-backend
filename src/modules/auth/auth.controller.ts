import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookies(res: Response, accessToken: string, refreshToken: string): void {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('az_access', accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
    res.cookie('az_refresh', refreshToken, { httpOnly: true, sameSite: 'lax', secure, path: '/v1/auth' });
  }

  @Post('request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto.phone, dto.code);
    this.setCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, tier: result.tier };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies.az_refresh ?? (req.body as { refreshToken?: string })?.refreshToken;
    if (!refreshToken) throw new AppException(ErrorCode.REFRESH_INVALID, 'Missing refresh token', 401);
    const result = await this.auth.refresh(refreshToken);
    this.setCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.id);
    res.clearCookie('az_access', { path: '/' });
    res.clearCookie('az_refresh', { path: '/v1/auth' });
    return { ok: true };
  }
}
