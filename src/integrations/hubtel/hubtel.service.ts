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
      // Never log the SMS body (may contain OTP) or full phone number — log masked/length-only.
      this.logger.debug(
        `[DEV SMS] to=${this.maskPhone(params.to)} ref=${params.reference} bodyLen=${params.body.length}`,
      );
      return { messageId: `dev-${params.reference}`, status: 'logged' };
    }

    // Real send: credentials go in HTTP Basic auth, never in the query string.
    // The exact Hubtel send path + auth scheme will be validated/hardened in Step 7
    // when NotificationsModule is completed.
    const url = `https://smsc.hubtel.com/v1/messages/send`;
    const res = await firstValueFrom(
      this.http.get(url, {
        params: { from: sender, to: params.to, content: params.body },
        auth: { username: clientId, password: clientSecret },
        timeout: 10_000,
      }),
    );
    const data = res.data as { MessageId?: string; Status?: number };
    return {
      messageId: data.MessageId ?? params.reference,
      status: data.Status === 0 ? 'sent' : 'queued',
    };
  }

  private maskPhone(p: string): string {
    return p.length <= 3 ? '***' : `***${p.slice(-3)}`;
  }
}
