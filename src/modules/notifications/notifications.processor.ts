import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../../workers/queue-names';
import {
  HubtelService,
  SendSmsParams,
} from '../../integrations/hubtel/hubtel.service';

@Processor(QUEUES.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly hubtel: HubtelService) {
    super();
  }

  async process(job: Job<SendSmsParams>): Promise<unknown> {
    if (job.name === 'send-sms') {
      return this.hubtel.sendSms(job.data);
    }
    return undefined;
  }
}
