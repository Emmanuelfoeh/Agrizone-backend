import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './common/services/prisma.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './common/redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty' }
            : undefined,
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],

        customProps: (req: any) => ({
          correlationId: (req as { correlationId?: string }).correlationId,
        }),
      },
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    EventEmitterModule.forRoot(),
    RedisModule,
    AuditModule,
    NotificationsModule,
    UsersModule,
    AuthModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
