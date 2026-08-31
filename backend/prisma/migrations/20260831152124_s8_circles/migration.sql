-- CreateEnum
CREATE TYPE "circle_tier" AS ENUM ('OPEN', 'INVITE_ONLY', 'INCOGNITO');

-- CreateEnum
CREATE TYPE "circle_category" AS ENUM ('ARTS_CULTURE', 'BOOKS_WRITING', 'BUSINESS_CAREER', 'EDUCATION_LEARNING', 'FAITH_SPIRITUALITY', 'FITNESS_WELLBEING', 'FOOD_DRINK', 'GAMING', 'HEALTH_SUPPORT', 'HOBBIES_CRAFTS', 'LGBTQ', 'MOVIES_TV', 'MUSIC', 'NIGHTLIFE_SOCIAL', 'OUTDOORS_NATURE', 'PARENTING_FAMILY', 'PETS_ANIMALS', 'PHOTOGRAPHY', 'SCIENCE_TECH', 'SPORTS', 'TRAVEL', 'VOLUNTEERING_CAUSES', 'OTHER');

-- CreateEnum
CREATE TYPE "circle_member_role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "circle_membership_status" AS ENUM ('ACTIVE', 'PENDING', 'INVITED');

-- CreateTable
CREATE TABLE "circles" (
    "id" TEXT NOT NULL,
    "public_short_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tier" "circle_tier" NOT NULL,
    "category" "circle_category" NOT NULL DEFAULT 'OTHER',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "circles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circle_memberships" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "circle_member_role" NOT NULL DEFAULT 'MEMBER',
    "status" "circle_membership_status" NOT NULL DEFAULT 'ACTIVE',
    "decided_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "circle_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "circles_public_short_id_key" ON "circles"("public_short_id");

-- CreateIndex
CREATE INDEX "circles_tier_category_created_at_idx" ON "circles"("tier", "category", "created_at");

-- CreateIndex
CREATE INDEX "circle_memberships_circle_id_status_idx" ON "circle_memberships"("circle_id", "status");

-- CreateIndex
CREATE INDEX "circle_memberships_user_id_status_idx" ON "circle_memberships"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "circle_memberships_circle_id_user_id_key" ON "circle_memberships"("circle_id", "user_id");

-- AddForeignKey
ALTER TABLE "circles" ADD CONSTRAINT "circles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_memberships" ADD CONSTRAINT "circle_memberships_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_memberships" ADD CONSTRAINT "circle_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
