import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import {
  PhotoAccess,
  VisibilityService,
} from '../../common/visibility/visibility.service';
import { BlocksService } from '../../common/blocks/blocks.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/**
 * Deep link encoded in a user's QR code.
 *
 * Carries ONLY the public short id. Never the internal user id (which would
 * leak the primary key into printable form) and never a phone number
 * (CLAUDE.md §1 — numbers are never exposed between users).
 */
const DEEP_LINK = (shortId: string) => `kinnred://u/${shortId}`;
const WEB_LINK = (shortId: string) => `https://kinnred.app/u/${shortId}`;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly visibility: VisibilityService,
    private readonly blocks: BlocksService,
  ) {}

  // -------------------------------------------------------------------------
  // Own profile
  // -------------------------------------------------------------------------

  /**
   * The acting user's own Myspace.
   *
   * Creates the Profile and UserSettings rows on first access rather than at
   * signup. Signup happens inside the auth flow where a failure costs the user
   * their OTP; lazily creating these keeps that path minimal.
   */
  async getMyProfile(userId: string) {
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
        profile: true,
        settings: true,
      },
    });

    if (!user) throw new NotFoundException('Account no longer exists');

    const profile = user.profile ?? (await this.ensureProfile(userId));
    const settings = user.settings ?? (await this.ensureSettings(userId));

    // Own photos are always UNLOCKED — resolved through VisibilityService
    // rather than assumed, so there is exactly one code path deciding this.
    const access = await this.visibility.resolveOne(userId, userId);
    const photos = await this.media.listViewablePhotos(userId, access.access);

    return {
      id: user.id,
      publicShortId: user.publicShortId,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      age: this.ageFrom(user.dateOfBirth),
      isVerified: user.isVerified,
      photosLocked: user.photosLocked,
      memberSince: user.createdAt,
      displayName: profile.displayName,
      bio: profile.bio,
      interests: profile.interests,
      lookingFor: profile.lookingFor,
      settings: {
        discoverable: settings.discoverable,
        recordProfileViews: settings.recordProfileViews,
      },
      photos,
    };
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    await this.ensureProfile(userId);

    await this.prisma.profile.update({
      where: { userId },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.interests !== undefined && { interests: dto.interests }),
        ...(dto.lookingFor !== undefined && { lookingFor: dto.lookingFor }),
      },
    });

    return this.getMyProfile(userId);
  }

  /**
   * Updates settings, plus `photosLocked`, which lives on User.
   *
   * `photosLocked` is exposed here because it is a user-facing privacy switch —
   * but note what is NOT settable through this path: `gender`, `isVerified`,
   * `phone`, or `publicShortId`. The DTO cannot express them and the global
   * ValidationPipe rejects unknown fields, so there is no route by which a
   * client can self-grant verification or change the gender that verification
   * froze (D-017).
   */
  async updateMySettings(userId: string, dto: UpdateSettingsDto) {
    await this.ensureSettings(userId);

    if (dto.photosLocked !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { photosLocked: dto.photosLocked },
      });
    }

    await this.prisma.userSettings.update({
      where: { userId },
      data: {
        ...(dto.discoverable !== undefined && {
          discoverable: dto.discoverable,
        }),
        ...(dto.recordProfileViews !== undefined && {
          recordProfileViews: dto.recordProfileViews,
        }),
      },
    });

    return this.getMyProfile(userId);
  }

  // -------------------------------------------------------------------------
  // Viewing someone else
  // -------------------------------------------------------------------------

  /**
   * Another user's public profile, looked up by PUBLIC SHORT ID.
   *
   * Short id rather than internal id on purpose: the short id is the sharing
   * primitive (QR codes, links) and the internal cuid should never need to be
   * known by a client to view a profile.
   *
   * Every photo goes through VisibilityService. Nothing here re-derives the
   * lock rule.
   */
  async getPublicProfile(viewerId: string, publicShortId: string) {
    const target = await this.prisma.user.findUnique({
      where: { publicShortId },
      select: {
        id: true,
        publicShortId: true,
        gender: true,
        dateOfBirth: true,
        isVerified: true,
        createdAt: true,
        profile: true,
      },
    });

    if (!target) throw new NotFoundException('Profile not found');

    // A block hides the whole profile, not just the photos. VisibilityService
    // would already return LOCKED here, but that would still serve the bio,
    // interests, age and verified status to someone who was blocked — and
    // record a profile view on the way (CLAUDE.md §2.5).
    //
    // The message and status are byte-identical to the unknown-short-id case
    // above, deliberately: a distinct error would confirm both that the
    // account exists and that it blocked you, which is exactly what someone
    // checks after being blocked.
    if (await this.blocks.isBlockedEitherWay(viewerId, target.id)) {
      throw new NotFoundException('Profile not found');
    }

    const decision = await this.visibility.resolveOne(viewerId, target.id);
    const photos = await this.media.listViewablePhotos(
      target.id,
      decision.access,
    );

    // Fire-and-forget relative to the response, but awaited so a failure is
    // not swallowed silently in the background.
    await this.recordView(viewerId, target.id);

    return {
      publicShortId: target.publicShortId,
      // NOTE: no `id`, no `phone`, no `dateOfBirth` — age only. Exposing an
      // exact date of birth is both a privacy leak and a common identity
      // verification answer.
      gender: target.gender,
      age: this.ageFrom(target.dateOfBirth),
      isVerified: target.isVerified,
      memberSince: target.createdAt,
      displayName: target.profile?.displayName ?? null,
      bio: target.profile?.bio ?? null,
      interests: target.profile?.interests ?? [],
      lookingFor: target.profile?.lookingFor ?? [],
      photos,
      photosBlurred: decision.access === PhotoAccess.BLURRED,
    };
  }

  /**
   * Records that `viewerId` looked at `viewedId`.
   *
   * Upserts one row per pair rather than appending. An append-only log would
   * be a precise, permanent browsing history for every user — a standing
   * privacy liability far beyond what the feature needs.
   *
   * Skipped entirely when the viewer has turned off `recordProfileViews`:
   * browsing without a trace is the point of that setting.
   */
  private async recordView(viewerId: string, viewedId: string): Promise<void> {
    if (viewerId === viewedId) return;

    const viewerSettings = await this.prisma.userSettings.findUnique({
      where: { userId: viewerId },
      select: { recordProfileViews: true },
    });

    // Absent settings means the row has not been created yet, which defaults
    // to recording (matching the column default).
    if (viewerSettings && !viewerSettings.recordProfileViews) return;

    await this.prisma.profileView.upsert({
      where: { viewerId_viewedId: { viewerId, viewedId } },
      create: { viewerId, viewedId },
      update: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
  }

  /**
   * "Who viewed your profile."
   *
   * Symmetry rule: a user who has disabled `recordProfileViews` — i.e. browses
   * invisibly — cannot see their own viewer list. Taking the benefit of
   * invisibility while still consuming other people's visibility is exactly
   * the asymmetry that makes the setting worth abusing.
   *
   * Viewer photos are resolved through VisibilityService in ONE batch call.
   * Per-viewer resolution here would be an N+1 (see VisibilityService docs).
   */
  async getMyViewers(userId: string, limit = 50) {
    const settings = await this.ensureSettings(userId);

    if (!settings.recordProfileViews) {
      return {
        enabled: false,
        reason:
          'You have profile-view recording turned off, so your own viewer list is unavailable.',
        viewers: [],
      };
    }

    const views = await this.prisma.profileView.findMany({
      where: { viewedId: userId },
      orderBy: { lastViewedAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        viewCount: true,
        lastViewedAt: true,
        viewer: {
          select: {
            id: true,
            publicShortId: true,
            gender: true,
            dateOfBirth: true,
            isVerified: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    const decisions = await this.visibility.resolveMany(
      userId,
      views.map((v) => v.viewer.id),
    );

    const viewers = await Promise.all(
      views.map(async (v) => {
        const access = decisions.get(v.viewer.id)?.access ?? PhotoAccess.LOCKED;
        const photos = await this.media.listViewablePhotos(v.viewer.id, access);

        return {
          publicShortId: v.viewer.publicShortId,
          displayName: v.viewer.profile?.displayName ?? null,
          gender: v.viewer.gender,
          age: this.ageFrom(v.viewer.dateOfBirth),
          isVerified: v.viewer.isVerified,
          viewCount: v.viewCount,
          lastViewedAt: v.lastViewedAt,
          photo: photos[0] ?? null,
        };
      }),
    );

    return { enabled: true, viewers };
  }

  // -------------------------------------------------------------------------
  // QR
  // -------------------------------------------------------------------------

  /**
   * The user's shareable QR code.
   *
   * Encodes only the public short id (D-…/CLAUDE.md §1). The short id is
   * random and non-enumerable, so a printed code reveals nothing beyond the
   * one profile it points at.
   */
  async getMyQr(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { publicShortId: true },
    });

    if (!user) throw new NotFoundException('Account no longer exists');

    const deepLink = DEEP_LINK(user.publicShortId);

    const svg = await QRCode.toString(deepLink, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
    });

    return {
      publicShortId: user.publicShortId,
      deepLink,
      webLink: WEB_LINK(user.publicShortId),
      svg,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private ensureProfile(userId: string) {
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private ensureSettings(userId: string) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /** Age in whole years. Only ever this — never the raw date of birth. */
  private ageFrom(dob: Date): number {
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDelta = now.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
      age -= 1;
    }
    return age;
  }
}
