import { ApiError, authedFetch } from './api';

export type MediaKind = 'PROFILE_PHOTO';
export type MediaStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'REJECTED';
export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface OwnMediaAsset {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  width: number | null;
  height: number | null;
  bytes: number | null;
  position: number | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface UploadReservation {
  assetId: string;
  uploadUrl: string;
  expiresInSeconds: number;
  maxBytes: number;
}

export const listOwnPhotos = () =>
  authedFetch<OwnMediaAsset[]>('/media?kind=PROFILE_PHOTO');

export const deletePhoto = (id: string) =>
  authedFetch<{ deleted: true }>(`/media/${id}`, { method: 'DELETE' });

const reserveUpload = (contentType: UploadContentType) =>
  authedFetch<UploadReservation>('/media/upload-url', {
    method: 'POST',
    body: { kind: 'PROFILE_PHOTO', contentType },
  });

const confirmUpload = (assetId: string) =>
  authedFetch<{ status: MediaStatus }>(`/media/${assetId}/confirm`, {
    method: 'POST',
  });

export interface PickedImage {
  uri: string;
  mimeType: UploadContentType;
  fileSize?: number;
}

/**
 * Full profile-photo upload: reserve → PUT bytes straight to storage → confirm.
 * The API never sees the bytes (CLAUDE.md §5); the worker validates them and
 * flips the asset to READY, which the caller then polls for.
 */
export async function uploadProfilePhoto(
  image: PickedImage,
): Promise<{ assetId: string }> {
  const reservation = await reserveUpload(image.mimeType);

  if (image.fileSize && image.fileSize > reservation.maxBytes) {
    throw new ApiError(413, {
      statusCode: 413,
      message: `That image is too large. Max ${Math.round(
        reservation.maxBytes / (1024 * 1024),
      )} MB.`,
    });
  }

  const blob = await (await fetch(image.uri)).blob();

  let putRes: Response;
  try {
    putRes = await fetch(reservation.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': image.mimeType },
      body: blob,
    });
  } catch (cause) {
    throw new ApiError(0, {
      statusCode: 0,
      message: 'Upload failed — check your connection and try again.',
      error: String(cause),
    });
  }

  if (!putRes.ok) {
    throw new ApiError(putRes.status, {
      statusCode: putRes.status,
      message: 'Storage rejected the upload. Try a different photo.',
    });
  }

  await confirmUpload(reservation.assetId);
  return { assetId: reservation.assetId };
}

/**
 * Poll the owner's gallery until `assetId` leaves PROCESSING. Resolves with the
 * terminal asset (READY or REJECTED) or throws on timeout.
 */
export async function waitForProcessing(
  assetId: string,
  { tries = 20, intervalMs = 1500 }: { tries?: number; intervalMs?: number } = {},
): Promise<OwnMediaAsset> {
  for (let i = 0; i < tries; i += 1) {
    const assets = await listOwnPhotos();
    const asset = assets.find((a) => a.id === assetId);
    if (asset && asset.status !== 'PROCESSING' && asset.status !== 'PENDING') {
      return asset;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new ApiError(0, {
    statusCode: 0,
    message: 'Still processing your photo. It should appear shortly.',
  });
}
