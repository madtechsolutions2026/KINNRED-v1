/**
 * KYC / liveness vendor boundary.
 *
 * The vendor is still undecided (CLAUDE.md §6 — Persona, Onfido, AWS
 * Rekognition are candidates), so everything vendor-shaped is confined behind
 * this interface. Nothing outside `kyc/` may import a vendor SDK or know a
 * vendor's payload shape.
 *
 * Note what this interface deliberately does NOT expose: any notion of gender.
 * The verified-female photo unlock was removed (D-036), so no vendor gender
 * attestation is needed — which is what lets us avoid a check that would have
 * hard-excluded trans women whose documents do not match.
 */
export const KYC_PROVIDER = Symbol('KYC_PROVIDER');

/** A decision, normalised away from whatever the vendor actually sent. */
export interface KycDecision {
  /**
   * The vendor's unique id for THIS delivery.
   *
   * Used for replay protection. Vendors deliver at-least-once and retry
   * aggressively, so the same decision will arrive more than once.
   */
  eventId: string;

  /** The vendor's id for the verification attempt. Matches providerRef. */
  providerRef: string;

  outcome: 'APPROVED' | 'REJECTED';

  /** Human-readable reason, surfaced to the user on rejection. */
  reason?: string;
}

export interface KycSession {
  providerRef: string;
  /** Where to send the user to complete liveness, if the vendor hosts it. */
  hostedUrl?: string;
}

export interface KycProvider {
  /** Adapter name, recorded on each request so decisions stay traceable. */
  readonly name: string;

  /** Opens a verification attempt with the vendor. */
  createSession(input: {
    userId: string;
    selfieAssetId: string;
    documentAssetId?: string;
  }): Promise<KycSession>;

  /**
   * Verifies a webhook came from the vendor.
   *
   * Takes the RAW request body, not the parsed object. Signatures are computed
   * over exact bytes, and re-serialising parsed JSON will not reproduce them —
   * key order and whitespace both change.
   *
   * Implementations MUST compare in constant time.
   */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean;

  /**
   * Normalises a vendor payload into a KycDecision.
   *
   * @returns null if the payload is not a decision we act on (vendors send
   *          plenty of informational events).
   */
  parseWebhook(payload: unknown): KycDecision | null;
}
