/**
 * Queue names.
 *
 * Declared centrally so a producer and its worker cannot drift apart via a
 * typo'd string literal — a mismatch there produces jobs that enqueue
 * successfully and are never consumed, with no error anywhere.
 *
 * Each entry maps to a service in BACKEND_PLAN.md.
 */
export const QUEUES = {
  /** S2 — post-upload validation, EXIF strip, blurred derivative generation. */
  MEDIA: 'media',
  /** S4 — expiry sweep for verification requests whose decision never arrived. */
  VERIFICATION: 'verification',
  /** S8 — LLM circle categorization (enum-validated on the way back in). */
  CATEGORIZATION: 'categorization',
  /** S10 — FCM/APNs dispatch and token invalidation feedback. */
  NOTIFICATIONS: 'notifications',
  /** S9 — delayed jobs for post timers, reminders, schedules. */
  SCHEDULING: 'scheduling',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Default job options.
 *
 * `removeOnComplete` is bounded rather than `true`: keeping a recent window is
 * what makes "did that push actually send?" answerable, while an unbounded
 * completed set is a well-known way to grow Redis memory until it evicts
 * something that mattered.
 *
 * Failed jobs are kept far longer — a failed KYC callback or push dispatch is
 * evidence, and it is not regenerable.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
