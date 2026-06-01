import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SendSmsParams {
  to: string;
  body: string;
  reference: string;
}

export interface SmsResult {
  messageId: string;
  status: 'sent' | 'queued' | 'failed' | 'logged';
}

@Injectable()
export class HubtelService {
  private readonly logger = new Logger(HubtelService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async sendSms(params: SendSmsParams): Promise<SmsResult> {
    const clientId = this.config.get<string>('HUBTEL_CLIENT_ID');
    const clientSecret = this.config.get<string>('HUBTEL_CLIENT_SECRET');
    const sender = this.config.get<string>('HUBTEL_SENDER_ID');

    // Dev stub: without credentials, log instead of sending. (Circuit breaker added in Step 7.)
    if (!clientId || !clientSecret || !sender) {
      this.logger.log(`[DEV SMS] to=${params.to} ref=${params.reference} body="${params.body}"`);
      return { messageId: `dev-${params.reference}`, status: 'logged' };
    }

    const url = `https://smsc.hubtel.com/v1/messages/send`;
    const res = await firstValueFrom(
      this.http.get(url, {
        params: { clientid: clientId, clientsecret: clientSecret, from: sender, to: params.to, content: params.body },
        timeout: 10_000,
      }),
    );
    const data = res.data as { MessageId?: string; Status?: number };
    return { messageId: data.MessageId ?? params.reference, status: data.Status === 0 ? 'sent' : 'queued' };
  }
}
