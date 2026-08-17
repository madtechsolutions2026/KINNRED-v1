import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';

/**
 * Global so every domain module can inject PrismaService without re-importing
 * it. Justified because there is exactly one connection pool per process —
 * making each module import it would imply otherwise.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: (config: AppConfig) => new PrismaService(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
