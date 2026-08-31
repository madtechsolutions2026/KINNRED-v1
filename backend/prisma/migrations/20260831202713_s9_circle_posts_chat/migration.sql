-- AlterTable
ALTER TABLE "circles" ADD COLUMN     "chat_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "circle_posts" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "reminder_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "circle_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circle_messages" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "circle_posts_circle_id_scheduled_for_created_at_idx" ON "circle_posts"("circle_id", "scheduled_for", "created_at");

-- CreateIndex
CREATE INDEX "circle_messages_circle_id_sent_at_idx" ON "circle_messages"("circle_id", "sent_at");

-- AddForeignKey
ALTER TABLE "circle_posts" ADD CONSTRAINT "circle_posts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_posts" ADD CONSTRAINT "circle_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
