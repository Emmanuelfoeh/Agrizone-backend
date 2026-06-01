import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from '../../workers/queue-names';
import { SendSmsParams } from '../../integrations/hubtel/hubtel.service';

@Injectable()
export class NotificationsService {
  constructor(@InjectQueue(QUEUES.NOTIFICATIONS) private readonly queue: Queue) {}

  async sendSms(params: SendSmsParams): Promise<void> {
    await this.queue.add('send-sms', params, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
