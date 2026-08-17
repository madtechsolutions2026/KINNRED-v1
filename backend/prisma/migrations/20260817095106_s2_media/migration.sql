-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('PROFILE_PHOTO', 'KYC_DOCUMENT');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'REJECTED');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" "media_kind" NOT NULL,
    "status" "media_status" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT NOT NULL,
    "blurred_key" TEXT,
    "content_type" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "rejection_reason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_assets_owner_id_kind_status_idx" ON "media_assets"("owner_id", "kind", "status");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "media_assets"("status", "created_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
