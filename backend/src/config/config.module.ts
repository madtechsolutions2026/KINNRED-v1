import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig, validateEnv } from './env.schema';

/**
 * Injection token for the fully-validated, strongly-typed config object.
 *
 * Prefer this over ConfigService. `ConfigService.get('KEY')` is stringly-typed
 * and returns `undefined` for a typo; injecting `AppConfig` makes an unknown
 * key a compile error and gives real types on every field (DECISIONS.md D-003).
 *
 *   constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Fails the boot if the environment is incomplete — see validateEnv.
      validate: validateEnv,
      cache: true,
      envFilePath: ['.env'],
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      // ConfigModule.forRoot has already loaded .env into process.env and
      // validated it by the time this factory runs. Re-parsing is pure and
      // costs nothing at boot, and it hands us the inferred type that
      // ConfigService cannot express.
      useFactory: (): AppConfig => validateEnv(process.env),
    },
  ],
  exports: [ConfigModule, APP_CONFIG],
})
export class AppConfigModule {}
