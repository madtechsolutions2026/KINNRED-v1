import { Inject, Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';
import { APP_CONFIG } from '../../../config/config.module';
import type { AppConfig } from '../../../config/env.schema';

/**
 * Development SMS provider: writes the OTP to the log instead of sending it.
 *
 * This lets the whole signup/login flow be exercised end-to-end with no vendor
 * account and no spend.
 *
 * SAFETY: this provider REFUSES TO RUN when NODE_ENV is production. Logging a
 * live login code is a credential leak into log storage — and logs are
 * routinely shipped to third-party aggregators, retained for months, and
 * readable by people who should not be able to log in as your users. Failing
 * loudly at construction is far better than discovering this in a log search.
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.NODE_ENV === 'production') {
      throw new Error(
        'MockSmsProvider must never run in production — it writes OTP codes to the log. ' +
          'Wire a real SmsProvider before deploying.',
      );
    }
  }

  sendOtp(phone: string, code: string): Promise<void> {
    // Deliberately bypasses the Pino redaction paths, which would otherwise
    // scrub this. That is the entire point of this class, and it is why the
    // production guard above exists.
    this.logger.warn(`[DEV ONLY] OTP for ${phone} is ${code}`);
    return Promise.resolve();
  }
}
