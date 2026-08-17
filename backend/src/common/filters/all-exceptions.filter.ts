import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';

/** Boundary between "caller's fault" (4xx) and "our fault" (5xx). */
const SERVER_ERROR_THRESHOLD = 500;

/** Shape returned to clients for every error. Stable contract for mobile. */
interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  requestId?: string;
  timestamp: string;
  path: string;
  /** Field-level validation detail. Present only for 400s from DTO validation. */
  details?: unknown;
}

/**
 * Global exception filter.
 *
 * Its main job is a security one: guarantee that an unexpected exception
 * becomes a generic 500 rather than leaking a stack trace, a Prisma error
 * containing SQL and column names, or a third-party vendor's error payload.
 *
 * Full detail always goes to the logs; only the safe subset goes to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // HttpExceptions are deliberate and safe to surface. Anything else is a
    // bug or an unhandled dependency failure, and its message is not
    // guaranteed to be free of internal detail.
    const { message, error, details } = isHttpException
      ? this.describeHttpException(exception)
      : {
          message: 'Internal server error',
          error: 'InternalServerError',
          details: undefined,
        };

    const body: ErrorResponseBody = {
      statusCode: status,
      message,
      error,
      requestId: request.id as string | undefined,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(details !== undefined ? { details } : {}),
    };

    // 5xx is our fault and gets a stack. 4xx is the caller's and would
    // otherwise flood logs with routine validation noise at error level.
    // Compared as a plain number: getStatus() returns number, and comparing it
    // against the HttpStatus enum is not a type-safe comparison.
    if (status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        {
          err: exception,
          statusCode: status,
          path: request.url,
          method: request.method,
        },
        'Unhandled exception',
      );
    } else {
      this.logger.warn(
        { statusCode: status, path: request.url, method: request.method },
        message,
      );
    }

    response.status(status).json(body);
  }

  /**
   * Unwraps Nest's HttpException payload, which is either a string or an
   * object (the latter is what ValidationPipe produces, with `message` as an
   * array of field errors).
   */
  private describeHttpException(exception: HttpException): {
    message: string;
    error: string;
    details?: unknown;
  } {
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { message: payload, error: exception.name };
    }

    const record = payload as Record<string, unknown>;
    const rawMessage = record.message;

    // ValidationPipe returns message: string[]. Keep the array as `details`
    // so clients can map errors to fields, and give `message` a summary.
    if (Array.isArray(rawMessage)) {
      return {
        message: 'Validation failed',
        error: (record.error as string) ?? exception.name,
        details: rawMessage,
      };
    }

    return {
      message: (rawMessage as string) ?? exception.message,
      error: (record.error as string) ?? exception.name,
    };
  }
}
