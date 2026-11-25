-- CreateEnum
CREATE TYPE "DocLanguage" AS ENUM ('TH', 'EN');

-- AlterTable
ALTER TABLE "quotation" ADD COLUMN     "pdfLanguage" "DocLanguage" NOT NULL DEFAULT 'TH';

-- AlterTable
ALTER TABLE "quotation_item" ADD COLUMN     "nameEn" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "signatureKey" TEXT;

-- CreateTable
CREATE TABLE "quotation_email" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "subject" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_email_quotationId_idx" ON "quotation_email"("quotationId");

-- CreateIndex
CREATE INDEX "quotation_email_sentById_sentAt_idx" ON "quotation_email"("sentById", "sentAt");

-- AddForeignKey
ALTER TABLE "quotation_email" ADD CONSTRAINT "quotation_email_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
