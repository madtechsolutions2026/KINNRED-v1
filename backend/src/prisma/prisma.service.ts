import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { AppConfig } from '../config/env.schema';

/**
 * Prisma client as a Nest provider.
 *
 * Prisma 7 requires a driver adapter — the embedded query engine is no longer
 * the default (DECISIONS.md D-012). We use `@prisma/adapter-pg`, which runs
 * queries through node-postgres.
 *
 * Per CLAUDE.md §3, this is injected only into services. Controllers never
 * touch it.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
      // Surface slow/failing queries through Nest's logger rather than
      // Prisma's stdout writer, so they land in the structured Pino output.
      log:
        config.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ]
          : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    // Connect eagerly. Prisma would otherwise connect lazily on first query,
    // which turns a bad DATABASE_URL into a failed user request instead of a
    // failed boot — the same fail-fast argument as env validation.
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Liveness probe for the health check. Deliberately trivial: it proves the
   * connection can execute a statement, without touching application tables.
   *
   * NOT named `ping()`. PrismaClient exposes one accessor per model, so the
   * S5 `Ping` model claims `prisma.ping` — a method of that name here shadows
   * the delegate and every `prisma.ping.findUnique(...)` in the codebase stops
   * compiling. Any method added to this class must avoid colliding with a
   * model name, and model names are domain vocabulary that will not move.
   */
  async checkConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * Reports whether the PostGIS extension is installed and its version.
   *
   * Included in the health check because a database that is *reachable* but
   * missing PostGIS is a specific, silent failure: the app boots fine and
   * every Grid query fails later with an unhelpful "function st_dwithin does
   * not exist". Better to surface it at /health.
   */
  async postgisVersion(): Promise<string | null> {
    const rows = await this.$queryRaw<Array<{ version: string | null }>>`
      SELECT extversion AS version FROM pg_extension WHERE extname = 'postgis'
    `;
    return rows[0]?.version ?? null;
  }
}
