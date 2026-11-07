import { AuthService } from './auth.service';
import { validateEnv, type AppConfig } from '../../config/env.schema';
import { verifyLowEntropySecret } from '../../common/crypto/secret-hash';

const phone = '+919900001000';
const outsider = '+919876543210';
function fixture(openRegistration = false) {
  const prisma = { otpChallenge: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}), findFirst: jest.fn() }, user: { findUnique: jest.fn() } };
  const tokens = { verifyRegistrationTicket: jest.fn().mockReturnValue(outsider) };
  const sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
  const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) };
  const config = { APP_STAGE: 'staging', STAGING_OPEN_REGISTRATION: openRegistration, STAGING_TEST_PHONES: [phone], NODE_ENV: 'development', DEV_FIXED_OTP: '000000', OTP_TTL_SECONDS: 300, OTP_MAX_PER_PHONE_PER_HOUR: 3 } as AppConfig;
  const service = new AuthService(prisma as never, tokens as never, sms, redis as never, config);
  return { service, prisma, tokens, sms, redis };
}
const env = { DATABASE_URL: 'postgresql://example:example@localhost/test', JWT_SECRET: 'j'.repeat(64), KYC_WEBHOOK_SECRET: 'k'.repeat(64), GRID_LOCATION_SALT: 'g'.repeat(64), STORAGE_ENDPOINT: 'http://localhost:9000', STORAGE_MEDIA_BUCKET: 'test-media', STORAGE_MEDIA_ACCESS_KEY_ID: 'test-media', STORAGE_MEDIA_SECRET_ACCESS_KEY: 'test-media-secret', STORAGE_KYC_BUCKET: 'test-kyc', STORAGE_KYC_ACCESS_KEY_ID: 'test-kyc', STORAGE_KYC_SECRET_ACCESS_KEY: 'test-kyc-secret' };

describe('staging authentication boundary', () => {
  it('rejects non-test OTP requests before touching Redis, database or SMS', async () => {
    const f = fixture(); await expect(f.service.requestOtp(outsider)).rejects.toThrow('test accounts only');
    expect(f.redis.incr).not.toHaveBeenCalled(); expect(f.prisma.otpChallenge.create).not.toHaveBeenCalled(); expect(f.sms.sendOtp).not.toHaveBeenCalled();
  });
  it('rejects non-test OTP verification before reading a challenge', async () => {
    const f = fixture(); await expect(f.service.verifyOtp(outsider, '000000')).rejects.toThrow('test accounts only');
    expect(f.prisma.otpChallenge.findFirst).not.toHaveBeenCalled();
  });
  it('rejects registration tickets for non-test phone numbers', async () => {
    const f = fixture(); await expect(f.service.register('signed-ticket', 'MALE', '1995-01-01')).rejects.toThrow('test accounts only');
    expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('still creates a normal salted, expiring OTP challenge for an approved test account', async () => {
    const f = fixture(); await expect(f.service.requestOtp(phone)).resolves.toEqual({ sent: true, expiresInSeconds: 300 });
    expect(f.sms.sendOtp).toHaveBeenCalledWith(phone, '000000');
    const data = f.prisma.otpChallenge.create.mock.calls[0][0].data;
    expect(data.codeHash).not.toBe('000000'); expect(await verifyLowEntropySecret('000000', data.codeHash)).toBe(true);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('fails closed when staging has no test-phone allowlist', () => {
    expect(() => validateEnv({ ...env, NODE_ENV: 'development', APP_STAGE: 'staging', STAGING_OPEN_REGISTRATION: 'false', STAGING_TEST_PHONES: '' })).toThrow('explicit test-phone allowlist');
  });
  it('allows different phone numbers only after open preview opt-in', async () => {
    const f = fixture(true);
    await expect(f.service.requestOtp(outsider)).resolves.toEqual({ sent: true, expiresInSeconds: 300 });
    expect(f.sms.sendOtp).toHaveBeenCalledWith(outsider, '000000');
  });
  it('permits an open staging configuration without an allowlist', () => {
    expect(validateEnv({ ...env, APP_STAGE: 'staging', STAGING_OPEN_REGISTRATION: 'true', DEV_FIXED_OTP: '000000' }).STAGING_OPEN_REGISTRATION).toBe(true);
  });
  it.each(['production', 'local'])('rejects open registration outside staging (%s)', (stage) => {
    expect(() => validateEnv({ ...env, APP_STAGE: stage, NODE_ENV: stage === 'production' ? 'production' : 'development', STAGING_OPEN_REGISTRATION: 'true' })).toThrow('Open demo registration requires staging');
  });
  it('requires a fixed demo code for open registration', () => {
    expect(() => validateEnv({ ...env, APP_STAGE: 'staging', STAGING_OPEN_REGISTRATION: 'true' })).toThrow('Open demo registration requires staging');
  });
  it('continues to reject fixed OTPs in production', () => {
    expect(() => validateEnv({ ...env, NODE_ENV: 'production', APP_STAGE: 'production', DEV_FIXED_OTP: '000000' })).toThrow('must not be set in production');
  });
  it('rejects a development process labelled as production', () => {
    expect(() => validateEnv({ ...env, NODE_ENV: 'development', APP_STAGE: 'production' })).toThrow('must use NODE_ENV=production');
  });
});
