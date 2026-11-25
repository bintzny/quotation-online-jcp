-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRICE', 'COMPETITOR', 'NO_BUDGET', 'OTHER');

-- CreateEnum
CREATE TYPE "FollowupChannel" AS ENUM ('PHONE', 'LINE', 'VISIT', 'EMAIL', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'QUOTATION_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'FOLLOWUP_STALE';

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "nextFollowupOn" DATE;

-- AlterTable
ALTER TABLE "quotation" ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "expiredAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastFollowupAt" TIMESTAMPTZ(3),
ADD COLUMN     "lostNote" TEXT,
ADD COLUMN     "lostReason" "LostReason",
ADD COLUMN     "nextFollowupOn" DATE,
ADD COLUMN     "poDate" DATE,
ADD COLUMN     "poKey" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "staleNotifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "followup" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quotationId" TEXT,
    "userId" TEXT NOT NULL,
    "contactedOn" DATE NOT NULL,
    "channel" "FollowupChannel" NOT NULL,
    "detail" TEXT NOT NULL,
    "nextDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "followup_quotationId_createdAt_idx" ON "followup"("quotationId", "createdAt");

-- CreateIndex
CREATE INDEX "followup_customerId_createdAt_idx" ON "followup"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_ownerId_nextFollowupOn_idx" ON "customer"("ownerId", "nextFollowupOn");

-- CreateIndex
CREATE INDEX "quotation_ownerId_nextFollowupOn_idx" ON "quotation"("ownerId", "nextFollowupOn");

-- AddForeignKey
ALTER TABLE "followup" ADD CONSTRAINT "followup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup" ADD CONSTRAINT "followup_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup" ADD CONSTRAINT "followup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Won needs the customer's PO number and date; Lost needs a reason (and a note for "other").
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_won_has_po"
  CHECK (status <> 'WON' OR ("poNumber" IS NOT NULL AND btrim("poNumber") <> '' AND "poDate" IS NOT NULL AND "closedAt" IS NOT NULL));
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_lost_has_reason"
  CHECK (status <> 'LOST' OR ("lostReason" IS NOT NULL AND "closedAt" IS NOT NULL AND ("lostReason" <> 'OTHER' OR btrim(coalesce("lostNote", '')) <> '')));

-- A follow-up says what happened, and the next one is not before it.
ALTER TABLE "followup" ADD CONSTRAINT "followup_detail_present" CHECK (btrim(detail) <> '');
ALTER TABLE "followup" ADD CONSTRAINT "followup_next_after_contact" CHECK ("nextDate" IS NULL OR "nextDate" >= "contactedOn");
