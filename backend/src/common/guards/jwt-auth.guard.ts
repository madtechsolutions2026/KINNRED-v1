import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** The authenticated principal attached to the request. */
export interface AuthenticatedUser {
  userId: string;
}

/** Express request carrying a verified principal. */
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

interface AccessClaims {
  sub?: string;
  typ?: string;
}

/**
 * Verifies the bearer token and attaches the acting user to the request.
 *
 * Registered globally (see AppModule), so routes are protected by default and
 * must opt out with @Public().
 *
 * DELIBERATELY LIGHTWEIGHT: it verifies the signature and attaches `userId`
 * only. It does NOT load the user from the database, because that would add a
 * query to every single request.
 *
 * The consequence must be understood by anything that builds on it: claims are
 * a snapshot from up to JWT_ACCESS_TTL (15m) ago. Any authorisation decision
 * that depends on state which can CHANGE — `isVerified` gating circle creation
 * and elevated profile viewing, `photosLocked`, block lists — must read the
 * database at the point of decision. Never put those in the token and never
 * trust a stale copy (DECISIONS.md D-020).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let claims: AccessClaims;
    try {
      claims = this.jwt.verify<AccessClaims>(token);
    } catch {
      // Never echo the underlying JWT error — "expired" vs "malformed" vs
      // "bad signature" is useful reconnaissance for a forger.
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Token-type check. Without it a short-lived registration ticket — handed
    // out to anyone who merely passes OTP — would be accepted here as though
    // it were an access token.
    if (claims.typ !== 'access' || !claims.sub) {
      throw new UnauthorizedException('Invalid token type');
    }

    request.user = { userId: claims.sub };
    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;

    return value;
  }
}
