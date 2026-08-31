import { authedFetch } from './api';

export type CircleTier = 'OPEN' | 'INVITE_ONLY' | 'INCOGNITO';
export type CircleRole = 'ADMIN' | 'MEMBER';
export type MembershipStatus = 'ACTIVE' | 'PENDING' | 'INVITED';

export type CircleCategory =
  | 'ARTS_CULTURE' | 'BOOKS_WRITING' | 'BUSINESS_CAREER' | 'EDUCATION_LEARNING'
  | 'FAITH_SPIRITUALITY' | 'FITNESS_WELLBEING' | 'FOOD_DRINK' | 'GAMING'
  | 'HEALTH_SUPPORT' | 'HOBBIES_CRAFTS' | 'LGBTQ' | 'MOVIES_TV' | 'MUSIC'
  | 'NIGHTLIFE_SOCIAL' | 'OUTDOORS_NATURE' | 'PARENTING_FAMILY' | 'PETS_ANIMALS'
  | 'PHOTOGRAPHY' | 'SCIENCE_TECH' | 'SPORTS' | 'TRAVEL'
  | 'VOLUNTEERING_CAUSES' | 'OTHER';

export const CATEGORY_LABELS: Record<CircleCategory, string> = {
  ARTS_CULTURE: 'Arts & Culture',
  BOOKS_WRITING: 'Books & Writing',
  BUSINESS_CAREER: 'Business & Career',
  EDUCATION_LEARNING: 'Education & Learning',
  FAITH_SPIRITUALITY: 'Faith & Spirituality',
  FITNESS_WELLBEING: 'Fitness & Wellbeing',
  FOOD_DRINK: 'Food & Drink',
  GAMING: 'Gaming',
  HEALTH_SUPPORT: 'Health & Support',
  HOBBIES_CRAFTS: 'Hobbies & Crafts',
  LGBTQ: 'LGBTQ+',
  MOVIES_TV: 'Movies & TV',
  MUSIC: 'Music',
  NIGHTLIFE_SOCIAL: 'Nightlife & Social',
  OUTDOORS_NATURE: 'Outdoors & Nature',
  PARENTING_FAMILY: 'Parenting & Family',
  PETS_ANIMALS: 'Pets & Animals',
  PHOTOGRAPHY: 'Photography',
  SCIENCE_TECH: 'Science & Tech',
  SPORTS: 'Sports',
  TRAVEL: 'Travel',
  VOLUNTEERING_CAUSES: 'Volunteering & Causes',
  OTHER: 'Other',
};

export const TIER_LABELS: Record<CircleTier, string> = {
  OPEN: 'Open',
  INVITE_ONLY: 'Invite only',
  INCOGNITO: 'Incognito',
};

export interface CircleSummary {
  publicShortId: string;
  name: string;
  description: string | null;
  tier: CircleTier;
  category: CircleCategory;
  memberCount: number;
  createdAt: string;
}

export interface MyCircle {
  publicShortId: string;
  name: string;
  tier: CircleTier;
  category: CircleCategory;
  role: CircleRole;
  membershipStatus: MembershipStatus;
}

export interface CircleDetail {
  publicShortId: string;
  name: string;
  description: string | null;
  tier: CircleTier;
  category: CircleCategory;
  chatEnabled: boolean;
  memberCount: number;
  createdAt: string;
  viewer: {
    role: CircleRole | null;
    membershipStatus: MembershipStatus | null;
    isAdmin: boolean;
  };
}

export interface CircleMember {
  publicShortId: string;
  displayName: string | null;
  role: CircleRole;
  joinedAt: string;
}

export interface JoinRequest {
  publicShortId: string;
  displayName: string | null;
  requestedAt: string;
}

export interface CirclePost {
  id: string;
  body: string;
  author: { publicShortId: string; displayName: string | null };
  mine: boolean;
  scheduledFor: string | null;
  reminderAt: string | null;
  createdAt: string;
}

export interface CircleMessage {
  id: string;
  body: string;
  sender: { publicShortId: string; displayName: string | null };
  mine: boolean;
  sentAt: string;
}

// --- browse / detail ---

export function browseCircles(opts: {
  q?: string;
  category?: CircleCategory;
  cursor?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (opts.q) qs.set('q', opts.q);
  if (opts.category) qs.set('category', opts.category);
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return authedFetch<{ circles: CircleSummary[]; nextCursor: string | null }>(
    `/circles${q ? `?${q}` : ''}`,
  );
}

export const listMyCircles = () => authedFetch<MyCircle[]>('/circles/mine');

export const getCircle = (shortId: string) =>
  authedFetch<CircleDetail>(`/circles/${shortId}`);

export const createCircle = (input: {
  name: string;
  description?: string;
  tier: CircleTier;
  category?: CircleCategory;
}) => authedFetch<CircleDetail>('/circles', { method: 'POST', body: input });

export const updateCircle = (
  shortId: string,
  input: {
    name?: string;
    description?: string;
    category?: CircleCategory;
    chatEnabled?: boolean;
  },
) => authedFetch<CircleDetail>(`/circles/${shortId}`, { method: 'PATCH', body: input });

// --- membership ---

export const getMembers = (shortId: string) =>
  authedFetch<{ circle: { publicShortId: string; name: string }; members: CircleMember[] }>(
    `/circles/${shortId}/members`,
  );

export const getJoinRequests = (shortId: string) =>
  authedFetch<JoinRequest[]>(`/circles/${shortId}/requests`);

export const joinCircle = (shortId: string) =>
  authedFetch<{ publicShortId: string; membershipStatus: string }>(
    `/circles/${shortId}/join`,
    { method: 'POST' },
  );

export const requestToJoin = (shortId: string) =>
  authedFetch<{ publicShortId: string; membershipStatus: string }>(
    `/circles/${shortId}/request`,
    { method: 'POST' },
  );

export const acceptInvite = (shortId: string) =>
  authedFetch<{ membershipStatus: string }>(`/circles/${shortId}/accept-invite`, {
    method: 'POST',
  });

export const leaveCircle = (shortId: string) =>
  authedFetch<{ left: true; dissolved: boolean }>(`/circles/${shortId}/leave`, {
    method: 'POST',
  });

export const decideRequest = (
  shortId: string,
  userShortId: string,
  approve: boolean,
) =>
  authedFetch<{ membershipStatus: string }>(
    `/circles/${shortId}/requests/${userShortId}/${approve ? 'approve' : 'reject'}`,
    { method: 'POST' },
  );

export const inviteMember = (shortId: string, publicShortId: string) =>
  authedFetch<{ membershipStatus: string }>(`/circles/${shortId}/invite`, {
    method: 'POST',
    body: { publicShortId },
  });

export const kickMember = (shortId: string, userShortId: string) =>
  authedFetch<{ removed: true }>(`/circles/${shortId}/members/${userShortId}`, {
    method: 'DELETE',
  });

// --- posts ---

export function getPosts(shortId: string, opts: { cursor?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return authedFetch<{ posts: CirclePost[]; nextCursor: string | null }>(
    `/circles/${shortId}/posts${q ? `?${q}` : ''}`,
  );
}

export const createPost = (
  shortId: string,
  input: { body: string; scheduledFor?: string; reminderAt?: string },
) => authedFetch<CirclePost>(`/circles/${shortId}/posts`, { method: 'POST', body: input });

export const deletePost = (shortId: string, postId: string) =>
  authedFetch<{ deleted: true }>(`/circles/${shortId}/posts/${postId}`, {
    method: 'DELETE',
  });

// --- group chat ---

export function getCircleMessages(
  shortId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const qs = new URLSearchParams();
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return authedFetch<{ messages: CircleMessage[]; nextCursor: string | null }>(
    `/circles/${shortId}/messages${q ? `?${q}` : ''}`,
  );
}

export const sendCircleMessage = (shortId: string, body: string) =>
  authedFetch<CircleMessage>(`/circles/${shortId}/messages`, {
    method: 'POST',
    body: { body },
  });
