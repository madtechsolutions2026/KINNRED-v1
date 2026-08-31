import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { APP_CONFIG } from '../../config/config.module';
import { REALTIME_NAMESPACE } from './realtime.gateway';
import type { AppConfig } from '../../config/env.schema';

/**
 * Publishes socket.io events into the Redis adapter's pub/sub channel WITHOUT
 * owning a socket server.
 *
 * This is the only way the queue worker (which serves no sockets, D-002) can
 * reach connected clients — and S9 needs exactly that: a scheduled circle post
 * or a reminder is delivered by a delayed job running in the worker.
 *
 * `RealtimeGateway` uses this as its fallback: in the API process `this.server`
 * exists and is emitted on directly (the Redis adapter still carries that emit
 * to other API instances); in the worker `this.server` is undefined and every
 * emit routes through here.
 *
 * Two things MUST line up with `RedisIoAdapter` or the worker publishes into a
 * channel nobody is listening on:
 *   - the adapter `key` (`<QUEUE_PREFIX>:socket.io`), and
 *   - the namespace (`/realtime`).
 */
@Injectable()
export class RealtimeEmitter {
  private readonly emitter: Emitter;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.emitter = new Emitter(
      redis,
      { key: `${config.QUEUE_PREFIX}:socket.io` },
      REALTIME_NAMESPACE,
    );
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    this.emitter.to(room).emit(event, payload);
  }
}
