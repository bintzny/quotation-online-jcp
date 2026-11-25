-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COUNTERED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_COUNTERED', 'APPROVAL_WITHDRAWN', 'APPROVAL_REMINDER');

-- CreateTable
CREATE TABLE "approval_request" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "lines" JSONB NOT NULL,
    "totalSatang" BIGINT NOT NULL,
    "approvedLines" JSONB,
    "counterLines" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "remindedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "quotationId" TEXT,
    "data" JSONB NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_request_quotationId_createdAt_idx" ON "approval_request"("quotationId", "createdAt");

-- CreateIndex
CREATE INDEX "approval_request_status_createdAt_idx" ON "approval_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_createdAt_idx" ON "notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One pending request per quotation; reasons are required
CREATE UNIQUE INDEX "approval_request_one_pending" ON "approval_request"("quotationId") WHERE "status" = 'PENDING';
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_reason_check" CHECK (length(trim("reason")) > 0);
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decision_check" CHECK (
  ("status" IN ('PENDING', 'WITHDRAWN')) OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
);
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_reject_reason_check" CHECK (
  "status" <> 'REJECTED' OR length(trim(coalesce("decisionNote", ''))) > 0
);
