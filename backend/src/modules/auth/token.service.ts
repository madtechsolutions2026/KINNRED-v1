import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_CONFIG } from '../../config/config.module';
import {
  generateRefreshToken,
  hashHighEntropyToken,
} from '../../common/crypto/secret-hash';
import { RevocationReason } from '../../generated/prisma/enums';
import type { AppConfig, DurationString } from '../../config/env.schema';

/** Claims carried by an access token. */
export interface AccessTokenClaims {
  sub: string;
  typ: 'access';
}

/** Claims carried by a short-lived registration ticket. */
interface RegistrationTicketClaims {
  phone: string;
  typ: 'registration';
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

/**
 * Converts a duration like `30d` / `15m` / `900s` into milliseconds.
 * Kept local and tiny rather than pulling in a dependency for one function.
 */
function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Expected a number followed by s, m, h or d (e.g. 15m).`,
    );
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * multipliers[unit];
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Access tokens & registration tickets
  // -------------------------------------------------------------------------

  private signAccessToken(userId: string): string {
    const claims: AccessTokenClaims = { sub: userId, typ: 'access' };
    return this.jwt.sign(claims, {
      // Safe: the env schema enforces the `ms` duration shape at boot.
      expiresIn: this.config.JWT_ACCESS_TTL as DurationString,
    });
  }

  /**
   * Ticket proving "this phone number just passed OTP" — handed out when the
   * number has no account yet, and exchanged at /auth/register.
   *
   * Short-lived, and tagged with `typ: 'registration'`. That tag is load
   * bearing: without distinguishing token types, a registration ticket would
   * be accepted by the auth guard as though it were an access token, letting
   * anyone who completes OTP act as an authenticated user with `sub`
   * undefined. Every verify path checks `typ`.
   */
  issueRegistrationTicket(phone: string): string {
    const claims: RegistrationTicketClaims = { phone, typ: 'registration' };
    return this.jwt.sign(claims, { expiresIn: '10m' });
  }

  verifyRegistrationTicket(ticket: string): string {
    let claims: RegistrationTicketClaims;
    try {
      claims = this.jwt.verify<RegistrationTicketClaims>(ticket);
    } catch {
      throw new UnauthorizedException(
        'Registration ticket is invalid or expired',
      );
    }

    if (claims.typ !== 'registration') {
      throw new UnauthorizedException('Wrong token type');
    }
    return claims.phone;
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Starts a new session: a fresh family plus its first refresh token. */
  async createSession(
    userId: string,
    deviceLabel?: string,
  ): Promise<IssuedSession> {
    const family = await this.prisma.refreshTokenFamily.create({
      data: { userId, deviceLabel },
    });

    const refreshToken = await this.issueRefreshToken(family.id);

    return {
      accessToken: this.signAccessToken(userId),
      refreshToken,
      expiresIn: this.config.JWT_ACCESS_TTL,
    };
  }

  private async issueRefreshToken(familyId: string): Promise<string> {
    const token = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        familyId,
        tokenHash: hashHighEntropyToken(token),
        expiresAt: new Date(
          Date.now() + parseDurationMs(this.config.JWT_REFRESH_TTL),
        ),
      },
    });
    // The plaintext is returned exactly once, here. Only its hash is stored.
    return token;
  }

  /**
   * Exchanges a refresh token for a new pair, rotating it.
   *
   * Reuse detection: presenting a token that has ALREADY been exchanged means
   * the token leaked and someone is replaying it — the legitimate client would
   * have moved on to the rotated one. We cannot tell attacker from victim, so
   * the whole family is revoked and both parties must log in again. Failing
   * closed is the only safe option; leaving the session alive would let the
   * thief keep refreshing indefinitely.
   */
  async rotate(presentedToken: string): Promise<IssuedSession> {
    const tokenHash = hashHighEntropyToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { family: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.family.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (stored.usedAt) {
      this.logger.warn(
        `Refresh token reuse detected on family ${stored.familyId} — revoking the whole family`,
      );
      await this.revokeFamily(stored.familyId, RevocationReason.TOKEN_REUSE);
      throw new UnauthorizedException(
        'Refresh token has already been used. This session has been revoked.',
      );
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Mark spent and issue the successor atomically — a crash between the two
    // would otherwise either strand the user or leave a replayable token.
    const [, nextToken] = await this.prisma.$transaction(async (tx) => {
      const used = await tx.refreshToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      });

      const raw = generateRefreshToken();
      await tx.refreshToken.create({
        data: {
          familyId: stored.familyId,
          tokenHash: hashHighEntropyToken(raw),
          expiresAt: new Date(
            Date.now() + parseDurationMs(this.config.JWT_REFRESH_TTL),
          ),
        },
      });
      return [used, raw] as const;
    });

    return {
      accessToken: this.signAccessToken(stored.family.userId),
      refreshToken: nextToken,
      expiresIn: this.config.JWT_ACCESS_TTL,
    };
  }

  /** Ends one session (logout on this device). */
  async revokeByToken(
    presentedToken: string,
    reason: RevocationReason,
  ): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashHighEntropyToken(presentedToken) },
    });

    // Silent no-op on an unknown token: reporting "no such token" would let a
    // caller probe which tokens exist, and logout should be idempotent anyway.
    if (!stored) return;

    await this.revokeFamily(stored.familyId, reason);
  }

  private async revokeFamily(
    familyId: string,
    reason: RevocationReason,
  ): Promise<void> {
    await this.prisma.refreshTokenFamily.update({
      where: { id: familyId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Ends every session for a user (logout everywhere, or a response to
   * suspected compromise). Already-revoked families are left untouched so the
   * original revocation reason survives for audit.
   */
  async revokeAllForUser(
    userId: string,
    reason: RevocationReason,
  ): Promise<number> {
    const result = await this.prisma.refreshTokenFamily.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }
}
