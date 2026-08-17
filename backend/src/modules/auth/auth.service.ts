import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService, IssuedSession } from './token.service';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
// `import type` is required here: with isolatedModules + emitDecoratorMetadata,
// a plain import of an interface used in a decorated constructor signature is
// a compile error (TS1272).
import type { SmsProvider } from './sms/sms-provider.interface';
import { APP_CONFIG } from '../../config/config.module';
import { REDIS_CLIENT } from '../../redis/redis.module';
import {
  generateOtpCode,
  hashLowEntropySecret,
  verifyLowEntropySecret,
} from '../../common/crypto/secret-hash';
import { generatePublicShortId } from '../../common/ids/public-short-id';
import { maskPhone } from '../../common/phone/phone.util';
import { Gender, RevocationReason } from '../../generated/prisma/enums';
import type { AppConfig } from '../../config/env.schema';

/** Result of verifying an OTP: either a session, or a prompt to finish signup. */
export type VerifyResult =
  | { status: 'authenticated'; session: IssuedSession; userId: string }
  | { status: 'registration_required'; registrationTicket: string };

/**
 * Genders whose photos are locked by default at signup.
 *
 * This list seeds `User.photosLocked` at creation ONLY. It is never consulted
 * again — the live visibility decision reads the column, so a user who later
 * changes their setting is respected (CLAUDE.md §2.1, DECISIONS.md D-019).
 */
const LOCKED_BY_DEFAULT: ReadonlySet<Gender> = new Set([
  Gender.FEMALE,
  Gender.NON_BINARY,
]);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // OTP request
  // -------------------------------------------------------------------------

  /**
   * Issues an OTP challenge.
   *
   * Deliberately returns the SAME response whether or not the number has an
   * account. Distinguishing them turns this endpoint into a registration
   * oracle — anyone could test numbers to learn who uses the app, which for a
   * dating/social product is a direct safety problem, not just a privacy one.
   */
  async requestOtp(
    phone: string,
  ): Promise<{ sent: true; expiresInSeconds: number }> {
    await this.enforcePerPhoneRateLimit(phone);

    const code = generateOtpCode(6);
    const expiresAt = new Date(Date.now() + this.config.OTP_TTL_SECONDS * 1000);

    // Invalidate any earlier live challenge for this number, so only the most
    // recent code works. Otherwise every unexpired code stays valid and the
    // attacker's guessing budget multiplies with each request.
    await this.prisma.otpChallenge.updateMany({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    await this.prisma.otpChallenge.create({
      data: { phone, codeHash: await hashLowEntropySecret(code), expiresAt },
    });

    await this.sms.sendOtp(phone, code);

    this.logger.log(`OTP issued for ${maskPhone(phone)}`);
    return { sent: true, expiresInSeconds: this.config.OTP_TTL_SECONDS };
  }

  /**
   * Per-phone hourly cap, counted in Redis.
   *
   * This is the SMS cost-abuse control. IP-based throttling (ThrottlerGuard on
   * the controller) is a separate layer and does not replace this one: an
   * attacker rotating IPs would sail past it while still billing us for a
   * message every time.
   */
  private async enforcePerPhoneRateLimit(phone: string): Promise<void> {
    const key = `otp:rate:${phone}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      // Set the window only on first increment, so a burst cannot keep
      // pushing the expiry out and reset its own budget.
      await this.redis.expire(key, 3600);
    }

    if (count > this.config.OTP_MAX_PER_PHONE_PER_HOUR) {
      const ttl = await this.redis.ttl(key);
      this.logger.warn(`OTP rate limit hit for ${maskPhone(phone)}`);
      // Nest has no TooManyRequestsException — 429 must be raised explicitly.
      throw new HttpException(
        `Too many verification codes requested. Try again in ${Math.max(ttl, 1)} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // -------------------------------------------------------------------------
  // OTP verification
  // -------------------------------------------------------------------------

  async verifyOtp(
    phone: string,
    code: string,
    deviceLabel?: string,
  ): Promise<VerifyResult> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    // One generic message for every failure mode below. Saying "code expired"
    // vs "no code requested" vs "wrong code" hands an attacker a state
    // oracle for free.
    const generic = new UnauthorizedException('Invalid or expired code');

    if (!challenge) throw generic;

    if (challenge.attempts >= this.config.OTP_MAX_ATTEMPTS) {
      // Burn it so it cannot be ground down further.
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw generic;
    }

    const matches = await verifyLowEntropySecret(code, challenge.codeHash);

    if (!matches) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw generic;
    }

    // Single-use: consume before issuing anything, so a replay of the same
    // code cannot mint a second session.
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { phone } });

    if (!user) {
      // Phone proven, but no account yet. Hand back a short-lived ticket
      // rather than asking for the code again — the code is now spent.
      return {
        status: 'registration_required',
        registrationTicket: this.tokens.issueRegistrationTicket(phone),
      };
    }

    const session = await this.tokens.createSession(user.id, deviceLabel);
    this.logger.log(`Login for user ${user.id}`);
    return { status: 'authenticated', session, userId: user.id };
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  async register(
    registrationTicket: string,
    gender: Gender,
    dateOfBirth: string,
    deviceLabel?: string,
  ): Promise<{
    session: IssuedSession;
    userId: string;
    publicShortId: string;
  }> {
    // Phone comes from the signed ticket, never from the request body — that
    // is what stops a caller registering someone else's number.
    const phone = this.tokens.verifyRegistrationTicket(registrationTicket);

    const dob = new Date(dateOfBirth);
    this.assertEligibleAge(dob);

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      throw new BadRequestException(
        'An account already exists for this number',
      );
    }

    const user = await this.createUserWithUniqueShortId({
      phone,
      gender,
      dateOfBirth: dob,
      // Seeded from gender here, then owned by the user thereafter.
      photosLocked: LOCKED_BY_DEFAULT.has(gender),
    });

    const session = await this.tokens.createSession(user.id, deviceLabel);
    this.logger.log(`Registered user ${user.id}`);

    return { session, userId: user.id, publicShortId: user.publicShortId };
  }

  /**
   * Enforces the minimum age.
   *
   * A hard requirement for a product like this, and it belongs server-side:
   * client-side age gates are trivially bypassed, and the consequence here is
   * minors on a proximity-based social app.
   */
  private assertEligibleAge(dob: Date): void {
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('dateOfBirth is not a valid date');
    }

    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDelta = now.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
      age -= 1;
    }

    if (age < 18) {
      throw new BadRequestException('You must be at least 18 to use Kinnred');
    }
    if (age > 120) {
      throw new BadRequestException('dateOfBirth is not plausible');
    }
  }

  /**
   * Creates the user, retrying on the (astronomically unlikely) short-ID
   * collision.
   *
   * Retry-on-conflict rather than check-then-insert: checking first races with
   * a concurrent signup, and the unique index is the only real guarantee.
   */
  private async createUserWithUniqueShortId(data: {
    phone: string;
    gender: Gender;
    dateOfBirth: Date;
    photosLocked: boolean;
  }) {
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.user.create({
          data: { ...data, publicShortId: generatePublicShortId() },
        });
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        const target = (error as { meta?: { target?: string[] } })?.meta
          ?.target;

        const isShortIdCollision =
          code === 'P2002' && target?.includes('public_short_id');

        if (!isShortIdCollision || attempt === MAX_ATTEMPTS) throw error;

        this.logger.warn(
          `publicShortId collision on attempt ${attempt}; regenerating`,
        );
      }
    }

    // Unreachable: the loop either returns or throws.
    throw new Error('Failed to allocate a unique publicShortId');
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  refresh(refreshToken: string): Promise<IssuedSession> {
    return this.tokens.rotate(refreshToken);
  }

  /**
   * The acting user's own record.
   *
   * Note the explicit `select`: never return the whole row. `phone` in
   * particular must not leak — CLAUDE.md §1 requires that phone numbers are
   * never exposed between users, and the safest way to honour that is for the
   * field to have no path out of the service layer at all.
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        publicShortId: true,
        gender: true,
        dateOfBirth: true,
        isVerified: true,
        photosLocked: true,
        createdAt: true,
      },
    });

    if (!user) {
      // Token verified but the user is gone (deleted account). The guard does
      // not hit the database, so this is where that surfaces.
      throw new UnauthorizedException('Account no longer exists');
    }

    return user;
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    await this.tokens.revokeByToken(refreshToken, RevocationReason.USER_LOGOUT);
    return { success: true };
  }

  async logoutAll(userId: string): Promise<{ success: true; revoked: number }> {
    const revoked = await this.tokens.revokeAllForUser(
      userId,
      RevocationReason.USER_LOGOUT_ALL,
    );
    return { success: true, revoked };
  }
}
