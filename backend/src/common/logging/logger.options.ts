import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/env.schema';

/**
 * Pino logger configuration (DECISIONS.md D-004).
 *
 * Redaction is configured here, at S0, rather than during the S11 hardening
 * pass. A redaction list written after the fact is a list of leaks already
 * shipped — and log retention means those leaks outlive the fix.
 */

/**
 * Paths scrubbed from every log line.
 *
 * This list is expected to GROW as services land. When a service starts
 * handling a new sensitive field, the redaction path is part of that service's
 * work, not a later cleanup:
 *   - S1  Auth          → phone, otp, tokens          (covered below)
 *   - S4  Verification  → KYC provider refs, doc URLs (add on arrival)
 *   - S7  Grid          → exact coordinates           (add on arrival)
 */
const REDACT_PATHS = [
  // Credentials in transit
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',

  // Auth material (S1). Bodies are not logged by default, but defence in
  // depth: a future debug log that dumps a body must not leak these.
  'req.body.password',
  'req.body.otp',
  'req.body.phone',
  'req.body.refreshToken',
  '*.password',
  '*.otp',
  '*.accessToken',
  '*.refreshToken',

  // Location (S7). CLAUDE.md §2.2 keeps exact coordinates service-internal;
  // a log file is very much not service-internal.
  '*.latitude',
  '*.longitude',
  '*.lat',
  '*.lng',
];

export function buildLoggerOptions(config: AppConfig): Params {
  const isDev = config.NODE_ENV === 'development';

  return {
    pinoHttp: {
      level: config.LOG_LEVEL,

      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
        // Do not crash if a path does not exist on a given object.
        remove: false,
      },

      // Correlation ID per request. Honour an inbound header so a request can
      // be traced across the API and the worker process (D-002 split them),
      // and generate one when absent.
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id =
          (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },

      // Trim the default serializers. The full req/res dump is noisy and is
      // the most likely accidental vector for logging something sensitive.
      //
      // pino-http types these as `any`, so they are narrowed explicitly here
      // rather than left implicit — an `any` inside the logging layer is how
      // an unexpected field quietly reaches a log line.
      serializers: {
        req: (req: IncomingMessage & { id?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: ServerResponse) => ({
          statusCode: res.statusCode,
        }),
      },

      // Health checks would otherwise dominate the logs once a load balancer
      // or uptime monitor starts polling.
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/health') ?? false,
      },

      // Human-readable in dev only. Production stays newline-delimited JSON so
      // it is queryable without a parsing layer.
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  };
}
