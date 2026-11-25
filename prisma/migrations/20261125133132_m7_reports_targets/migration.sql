-- AlterTable
ALTER TABLE "quotation" ADD COLUMN     "firstSentAt" TIMESTAMPTZ(3),
ADD COLUMN     "firstSentById" TEXT;

-- CreateTable
CREATE TABLE "sales_target" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "amountSatang" BIGINT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_target_month_idx" ON "sales_target"("month");

-- CreateIndex
CREATE UNIQUE INDEX "sales_target_userId_month_key" ON "sales_target"("userId", "month");

-- CreateIndex
CREATE INDEX "quotation_firstSentAt_idx" ON "quotation"("firstSentAt");

-- CreateIndex
CREATE INDEX "quotation_closedAt_idx" ON "quotation"("closedAt");

-- AddForeignKey
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Targets are never negative.
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_not_negative" CHECK ("amountSatang" >= 0);

-- Backfill: the first sent revision gives the first send date and who sent it.
UPDATE "quotation" q
   SET "firstSentAt" = f.sent_at, "firstSentById" = f.sent_by
  FROM (SELECT DISTINCT ON ("quotationId") "quotationId", "sentAt" AS sent_at, "sentById" AS sent_by
          FROM "quotation_revision"
         ORDER BY "quotationId", "sentAt" ASC) f
 WHERE f."quotationId" = q.id AND q."firstSentAt" IS NULL;
