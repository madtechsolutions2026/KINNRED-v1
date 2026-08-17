import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { KYC_PROVIDER } from './kyc/kyc-provider.interface';
import { MockKycProvider } from './kyc/mock-kyc.provider';

/**
 * Verification (KYC / liveness).
 *
 * The vendor is chosen here and nowhere else. Swapping Persona/Onfido in is a
 * one-line change to this provider binding — nothing outside `kyc/` knows a
 * vendor payload shape (CLAUDE.md §5).
 *
 * MockKycProvider is exported so tests can sign webhook payloads the way a
 * vendor would; it refuses to construct in production.
 */
@Module({
  controllers: [VerificationController],
  providers: [
    VerificationService,
    MockKycProvider,
    { provide: KYC_PROVIDER, useExisting: MockKycProvider },
  ],
  exports: [VerificationService, MockKycProvider],
})
export class VerificationModule {}
