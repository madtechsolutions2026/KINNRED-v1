import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Database health.
 *
 * Checks two distinct things, because they fail independently:
 *  1. the connection can execute a statement, and
 *  2. PostGIS is actually installed.
 *
 * (2) matters because a reachable database without PostGIS is a silent trap —
 * the app boots cleanly and every Grid proximity query fails much later with
 * "function st_dwithin does not exist", pointing nowhere near the real cause.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async isHealthy(key = 'database') {
    const indicator = this.health.check(key);

    try {
      await this.prisma.checkConnection();
    } catch (error) {
      return indicator.down({
        reason: 'unreachable',
        // Error text is safe here: /health/detail is not publicly exposed
        // (DECISIONS.md D-005) and connection errors aid diagnosis.
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }

    const postgis = await this.prisma.postgisVersion();

    if (!postgis) {
      return indicator.down({
        reason: 'postgis-missing',
        message:
          'Connected, but the PostGIS extension is not installed. Grid proximity queries will fail.',
      });
    }

    return indicator.up({ postgis });
  }
}
