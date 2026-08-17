import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
import { MockSmsProvider } from './sms/mock-sms.provider';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig, DurationString } from '../../config/env.schema';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_SECRET,
        // HS256 (the default). Symmetric is correct while a single service
        // both issues and verifies tokens. Revisit if a second service ever
        // needs to verify without holding signing power — that is the point
        // at which RS256 earns its extra complexity (DECISIONS.md D-021).
        signOptions: {
          // Safe: the env schema enforces this exact shape at boot.
          expiresIn: config.JWT_ACCESS_TTL as DurationString,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    {
      // Swappable behind the SMS_PROVIDER token. Replacing the mock with a
      // real vendor is a one-line change here and nothing else.
      provide: SMS_PROVIDER,
      useClass: MockSmsProvider,
    },
  ],
  // Exported so the global JwtAuthGuard can verify tokens, and so later
  // services (S4 verification, S6 visibility) can revoke sessions.
  exports: [JwtModule, TokenService],
})
export class AuthModule {}
