-- CreateEnum
CREATE TYPE "plan_request_state" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "public_short_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "place" VARCHAR(120) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_requests" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" "plan_request_state" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_public_short_id_key" ON "plans"("public_short_id");

-- CreateIndex
CREATE INDEX "plans_owner_id_starts_at_idx" ON "plans"("owner_id", "starts_at");

-- CreateIndex
CREATE INDEX "plans_cancelled_starts_at_idx" ON "plans"("cancelled", "starts_at");

-- CreateIndex
CREATE INDEX "plan_requests_user_id_state_idx" ON "plan_requests"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "plan_requests_plan_id_user_id_key" ON "plan_requests"("plan_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
