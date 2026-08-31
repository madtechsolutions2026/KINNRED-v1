import { Platform } from 'react-native';
import { apiFetch } from './api';
import type { StoredSession } from './session';

export const DEVICE_LABEL = `Kinnred · ${
  Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'
}`;

interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface RequestOtpResult {
  sent: true;
  expiresInSeconds: number;
}

export type VerifyOtpResult =
  | { status: 'authenticated'; session: IssuedSession; userId: string }
  | { status: 'registration_required'; registrationTicket: string };

interface RegisterResult {
  session: IssuedSession;
  userId: string;
  publicShortId: string;
}

export type Gender =
  | 'FEMALE'
  | 'MALE'
  | 'NON_BINARY'
  | 'PREFER_NOT_TO_SAY';

export function requestOtp(phone: string): Promise<RequestOtpResult> {
  return apiFetch<RequestOtpResult>('/auth/otp/request', {
    method: 'POST',
    body: { phone },
  });
}

export function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  return apiFetch<VerifyOtpResult>('/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, deviceLabel: DEVICE_LABEL },
  });
}

export function register(input: {
  registrationTicket: string;
  gender: Gender;
  dateOfBirth: string; // YYYY-MM-DD
}): Promise<RegisterResult> {
  return apiFetch<RegisterResult>('/auth/register', {
    method: 'POST',
    body: { ...input, deviceLabel: DEVICE_LABEL },
  });
}

export function toStoredSession(
  session: IssuedSession,
  userId: string,
): StoredSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId,
  };
}
