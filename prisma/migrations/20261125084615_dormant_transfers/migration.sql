-- CreateEnum
CREATE TYPE "CustomerLostReason" AS ENUM ('CLOSED_BUSINESS', 'COMPETITOR', 'OTHER');

-- CreateEnum
CREATE TYPE "DormantOutcome" AS ENUM ('STILL_CUSTOMER', 'CLOSED_BUSINESS', 'COMPETITOR', 'OTHER');

-- CreateEnum
CREATE TYPE "TransferRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ImportKind" ADD VALUE 'LAST_SALES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CUSTOMER_DORMANT';
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOMER_TRANSFERRED_IN';
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOMER_TRANSFERRED_OUT';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_REJECTED';

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "dormantNotifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "dormantSnoozedUntil" DATE,
ADD COLUMN     "expressLastSaleDate" DATE,
ADD COLUMN     "expressSales12mSatang" BIGINT,
ADD COLUMN     "lostAt" TIMESTAMPTZ(3),
ADD COLUMN     "lostNote" TEXT,
ADD COLUMN     "lostReason" "CustomerLostReason";

-- AlterTable
ALTER TABLE "followup" ADD COLUMN     "outcome" "DormantOutcome";

-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "quotation" ADD COLUMN     "ownerSince" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "customer_transfer_request" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "fromOwnerId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "TransferRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_transfer_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "mail_digest" (
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_digest_pkey" PRIMARY KEY ("userId","kind","periodStart")
);

-- CreateIndex
CREATE INDEX "customer_transfer_request_status_createdAt_idx" ON "customer_transfer_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "customer_transfer_request_customerId_status_idx" ON "customer_transfer_request"("customerId", "status");

-- CreateIndex
CREATE INDEX "customer_lastPurchaseDate_idx" ON "customer"("lastPurchaseDate");

-- AddForeignKey
ALTER TABLE "customer_transfer_request" ADD CONSTRAINT "customer_transfer_request_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_transfer_request" ADD CONSTRAINT "customer_transfer_request_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Added by hand ──

-- One open request per salesperson and customer.
CREATE UNIQUE INDEX "customer_transfer_request_one_pending" ON "customer_transfer_request"("customerId", "requesterId") WHERE "status" = 'PENDING';

-- A decided request records who decided and when.
ALTER TABLE "customer_transfer_request" ADD CONSTRAINT "transfer_request_decided"
  CHECK ("status" IN ('PENDING', 'CANCELLED') OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "customer_transfer_request" ADD CONSTRAINT "transfer_request_reason_present" CHECK (btrim("reason") <> '');

-- Customers marked lost before M6 (none expected) get a reason so the rule below holds.
UPDATE "customer" SET "lostReason" = 'OTHER', "lostAt" = CURRENT_TIMESTAMP WHERE "status" = 'LOST' AND "lostReason" IS NULL;
ALTER TABLE "customer" ADD CONSTRAINT "customer_lost_has_reason"
  CHECK ("status" <> 'LOST' OR ("lostReason" IS NOT NULL AND "lostAt" IS NOT NULL));
ALTER TABLE "customer" ADD CONSTRAINT "customer_express_sales_not_negative"
  CHECK ("expressSales12mSatang" IS NULL OR "expressSales12mSatang" >= 0);

-- Last purchase from quotations already marked Won (the Bangkok day they were marked).
UPDATE "customer" c
   SET "lastPurchaseDate" = w.last_won
  FROM (SELECT "customerId", max(("closedAt" AT TIME ZONE 'Asia/Bangkok')::date) AS last_won
          FROM "quotation" WHERE "status" = 'WON' AND "closedAt" IS NOT NULL GROUP BY "customerId") w
 WHERE w."customerId" = c.id
   AND (c."lastPurchaseDate" IS NULL OR c."lastPurchaseDate" < w.last_won);
