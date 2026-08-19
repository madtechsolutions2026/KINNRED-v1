import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/config.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import type { AppConfig } from './config/env.schema';

/**
 * API entrypoint.
 *
 * The queue worker runs as a separate process — see worker.ts (D-002).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Buffer startup logs until Pino is available, otherwise early boot lines
    // bypass the structured logger and its redaction rules.
    bufferLogs: true,

    // Retains the unparsed request body on `req.rawBody`.
    //
    // Required by the KYC webhook: HMAC signatures are computed over exact
    // bytes, and re-serialising parsed JSON will not reproduce them — key
    // order and whitespace both change. Without this, signature verification
    // silently fails for every legitimate callback.
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(APP_CONFIG);

  app.use(helmet());

  // CORS. Needed only by browser clients — the React Native *web* build in
  // mobile/ is the first one; native apps do not enforce it.
  //
  // The allowlist is explicit and comes from config, which resolves to the
  // local Expo dev origins outside production and to whatever CORS_ORIGINS
  // names inside it. An empty list is a valid, fail-closed production value
  // for a mobile-only deployment.
  //
  // `credentials` stays FALSE: auth here is a bearer token in the
  // Authorization header, never a cookie. Enabling it would permit
  // cookie-bearing cross-origin requests this API has no use for, and would
  // make any future wildcard mistake far more dangerous.
  app.enableCors({
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 600,
  });

  // /api/v1/... — set up now, while there are zero endpoints, because
  // store-installed mobile clients cannot be force-upgraded (D-007).
  //
  // Health is excluded so probes hit bare /health. Note this exclusion alone
  // is NOT sufficient: URI versioning would still push it to /api/v1/health,
  // so HealthController is additionally marked VERSION_NEUTRAL.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/detail', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties with no matching DTO decorator. This is a security
      // control, not tidiness: it stops a client smuggling extra fields into
      // an object that later reaches Prisma (e.g. an `isVerified` that was
      // never meant to be settable).
      whitelist: true,
      // And reject outright rather than silently dropping, so a client
      // sending something unexpected finds out.
      forbidNonWhitelisted: true,
      // Enables DTO type coercion (route params to number, etc.).
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // API docs. Built outside production only: the schema is a complete map of
  // the attack surface, and there is no reason to publish it.
  if (config.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Kinnred API')
      .setDescription(
        'Location-based social discovery. See CLAUDE.md for safety rules.',
      )
      .setVersion('1')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // Socket.io with the Redis adapter (S5).
  //
  // Wired here, BEFORE listen(), and awaited — createIOServer runs during
  // listen, so an adapter that is still connecting at that point is silently
  // skipped and the gateway falls back to single-instance behaviour. That
  // failure is invisible in development and intermittent in production.
  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connect();
  app.useWebSocketAdapter(ioAdapter);

  // Lets Nest run onModuleDestroy / onApplicationShutdown so Prisma and Redis
  // close cleanly on SIGTERM. Without this a container restart drops
  // in-flight work rather than draining it.
  app.enableShutdownHooks();

  await app.listen(config.PORT);

  const logger = app.get(Logger);
  logger.log(
    `API listening on http://localhost:${config.PORT} (env: ${config.NODE_ENV})`,
  );
  logger.log(`Health: http://localhost:${config.PORT}/health`);
  // Logged because a CORS failure shows up in the browser as an opaque
  // "blocked" with no server-side trace — this line is the only place the
  // effective allowlist is visible.
  logger.log(
    config.CORS_ORIGINS.length
      ? `CORS origins: ${config.CORS_ORIGINS.join(', ')}`
      : 'CORS: no browser origins allowed (mobile-only)',
  );
}

/**
 * Boot failures MUST be visible.
 *
 * `bufferLogs: true` holds log output until `useLogger()` attaches Pino — but
 * if NestFactory.create() itself throws (a bad DATABASE_URL, an unreachable
 * Redis), that never happens and the buffer is silently discarded. The process
 * then dies having printed nothing at all, which is close to the worst
 * possible operational behaviour: no message, and an exit code that looks like
 * a clean shutdown to a container runtime.
 *
 * This was observed in practice during S0, not theorised.
 *
 * console.error is deliberate here rather than a logger — at this point there
 * is no guarantee a working logger exists.
 */
bootstrap().catch((error: unknown) => {
  console.error('FATAL: API failed to start.');
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  // Non-zero so orchestrators treat it as the failure it is and restart or
  // surface it, rather than assuming a graceful exit.
  process.exit(1);
});
