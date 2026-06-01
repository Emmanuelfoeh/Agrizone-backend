import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUES } from '../../workers/queue-names';
import { HubtelModule } from '../../integrations/hubtel/hubtel.module';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL')!);
        return {
          connection: { host: url.hostname, port: Number(url.port || 6379) },
        };
      },
    }),
    BullModule.registerQueue({ name: QUEUES.NOTIFICATIONS }),
    HubtelModule,
  ],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
