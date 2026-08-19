/**
 * SMS delivery boundary.
 *
 * Kept as an interface with an injection token so the vendor can be swapped
 * without touching AuthService. Vendor choice is still open, and in India DLT
 * template registration takes days — the app must be fully testable before
 * that lands (DECISIONS.md D-019).
 *
 * COST: billed per message sent, and reachable by anyone who can hit
 * POST /auth/otp/request. See EXTERNAL_SERVICES.md before changing the
 * per-phone rate limit in AuthService.
 */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /**
   * @param phone E.164 formatted destination.
   * @param code  The plaintext OTP. Implementations MUST NOT log this in
   *              production — see MockSmsProvider for the dev-only exception.
   */
  sendOtp(phone: string, code: string): Promise<void>;
}
