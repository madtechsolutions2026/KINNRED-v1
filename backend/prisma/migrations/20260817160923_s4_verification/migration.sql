-- S4 - Verification (KYC / liveness)
--
-- Also drops user_settings.stay_locked_regardless: it existed only to let an
-- owner opt out of the verified-female photo unlock, and that rule was removed
-- entirely (DECISIONS.md D-036). The column had nothing left to control.
-- CreateEnum
CREATE TYPE "verification_state" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "user_settings" DROP COLUMN "stay_locked_regardless";

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" "verification_state" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "selfie_asset_id" TEXT,
    "document_asset_id" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_requests_provider_ref_key" ON "verification_requests"("provider_ref");

-- CreateIndex
CREATE INDEX "verification_requests_user_id_state_idx" ON "verification_requests"("user_id", "state");

-- CreateIndex
CREATE INDEX "verification_requests_state_created_at_idx" ON "verification_requests"("state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_webhook_events_provider_event_id_key" ON "kyc_webhook_events"("provider", "event_id");

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
