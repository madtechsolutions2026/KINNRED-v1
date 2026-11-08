import { authedFetch } from './api';
import type { Gender } from './auth-api';

export type LookingFor =
  | 'DATING'
  | 'FRIENDSHIP'
  | 'NETWORKING'
  | 'ACTIVITY_PARTNERS'
  | 'JUST_EXPLORING';

export const LOOKING_FOR_LABELS: Record<LookingFor, string> = {
  DATING: 'Dating',
  FRIENDSHIP: 'Friendship',
  NETWORKING: 'Networking',
  ACTIVITY_PARTNERS: 'Activity partners',
  JUST_EXPLORING: 'Just exploring',
};

export interface Photo {
  id: string;
  url: string;
  blurred: boolean;
}

export interface MyProfile {
  id: string;
  publicShortId: string;
  username?: string | null;
  gender: Gender;
  dateOfBirth: string;
  age: number;
  isVerified: boolean;
  photosLocked: boolean;
  memberSince: string;
  displayName: string | null;
  bio: string | null;
  interests: string[];
  lookingFor: LookingFor[];
  settings: {
    discoverable: boolean;
    recordProfileViews: boolean;
  };
  photos: Photo[];
}

export interface UpdateProfileInput {
  username?: string;
  gender?: Gender;
  displayName?: string;
  bio?: string;
  interests?: string[];
  lookingFor?: LookingFor[];
}

export interface UpdateSettingsInput {
  photosLocked?: boolean;
  discoverable?: boolean;
  recordProfileViews?: boolean;
}

export interface QrPayload {
  publicShortId: string;
  deepLink: string;
  webLink: string;
  svg: string;
}

export interface Viewer {
  publicShortId: string;
  displayName: string | null;
  gender: Gender;
  age: number;
  isVerified: boolean;
  viewCount: number;
  lastViewedAt: string;
  photo: Photo | null;
}

export type ViewersResult =
  | { enabled: true; viewers: Viewer[] }
  | { enabled: false; reason: string; viewers: [] };

export const getMyProfile = () => authedFetch<MyProfile>('/users/me');

export const updateProfile = (input: UpdateProfileInput) =>
  authedFetch<MyProfile>('/users/me', { method: 'PATCH', body: input });

export const updateSettings = (input: UpdateSettingsInput) =>
  authedFetch<MyProfile>('/users/me/settings', { method: 'PATCH', body: input });

export const getMyQr = () => authedFetch<QrPayload>('/users/me/qr');

export const getMyViewers = () => authedFetch<ViewersResult>('/users/me/viewers');

export interface PublicProfile {
  publicShortId: string;
  username?: string | null;
  gender: Gender;
  age: number;
  isVerified: boolean;
  memberSince: string;
  displayName: string | null;
  bio: string | null;
  interests: string[];
  lookingFor: LookingFor[];
  photos: Photo[];
  photosBlurred: boolean;
}

export const getPublicProfile = (publicShortId: string) =>
  authedFetch<PublicProfile>(`/users/${publicShortId}`);
