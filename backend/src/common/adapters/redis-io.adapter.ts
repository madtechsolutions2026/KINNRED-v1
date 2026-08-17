import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { APP_CONFIG } from '../../config/config.module';
import { buildRedisOptions } from '../../redis/redis.module';
import type { AppConfig } from '../../config/env.schema';

/**
 * Socket.io with the Redis adapter, wired from day one (BACKEND_PLAN S5).
 *
 * WHY THIS IS NOT A LATER SCALING TASK: socket.io keeps its room membership in
 * the memory of the process that accepted the connection. With two API
 * instances behind a load balancer, an emit issued by instance A never reaches
 * a user whose socket landed on instance B. The failure is invisible in
 * development — one process, everything works — and appears as "messages
 * sometimes don't arrive" in production, intermittently, depending on which
 * instance served which request. Retrofitting it means re-testing every
 * realtime path.
 *
 * The adapter turns emits into Redis pub/sub messages that every instance
 * receives, so `to(room).emit(...)` reaches the room wherever it lives.
 *
 * DEDICATED CONNECTIONS, NOT THE SHARED CLIENT: a Redis connection in
 * subscriber mode cannot run ordinary commands, so the subscriber must be its
 * own connection. Reusing REDIS_CLIENT here would break rate-limit counters and
 * presence the moment the adapter subscribed on it.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);

  private pubClient?: Redis;
  private subClient?: Redis;
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplication) {
    super(app);
  }

  async connect(): Promise<void> {
    const config = this.app.get<AppConfig>(APP_CONFIG);
    const options = buildRedisOptions(config);

    this.pubClient = new Redis({ ...options, lazyConnect: true });
    this.subClient = this.pubClient.duplicate();

    // Awaited so a dead Redis surfaces as a boot failure rather than as
    // sockets that connect fine and silently never deliver cross-instance.
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient, {
      // Namespaced so a shared Redis cannot cross-deliver between environments
      // — the same reasoning as the BullMQ queue prefix.
      key: `${config.QUEUE_PREFIX}:socket.io`,
    });

    this.logger.log('Socket.io Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (a: unknown) => void;
    };

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    } else {
      // Loud, because the process still works perfectly on one instance. A
      // silent fallback here is exactly how single-instance-only realtime
      // reaches production.
      this.logger.error(
        'Redis adapter unavailable — sockets will only work within a single instance. ' +
          'connect() must be awaited before the server starts.',
      );
    }

    return server;
  }

  async close(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
