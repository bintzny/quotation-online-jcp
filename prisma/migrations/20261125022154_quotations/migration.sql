-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'WON', 'LOST', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'PERCENT', 'AMOUNT');

-- CreateTable
CREATE TABLE "doc_sequence" (
    "companyId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,

    CONSTRAINT "doc_sequence_pkey" PRIMARY KEY ("companyId","yearMonth")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "validUntil" DATE NOT NULL,
    "creditDays" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerTaxId" TEXT,
    "customerBranchCode" TEXT NOT NULL,
    "customerBranchName" TEXT,
    "customerAddress" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "billDiscountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "billDiscountValue" INTEGER NOT NULL DEFAULT 0,
    "subtotalSatang" BIGINT NOT NULL,
    "billDiscountSatang" BIGINT NOT NULL,
    "afterDiscountSatang" BIGINT NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "vatSatang" BIGINT NOT NULL,
    "totalSatang" BIGINT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "note" TEXT,
    "terms" TEXT,
    "cancelReason" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "copiedFromId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_item" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "productCode" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "quantityMilli" INTEGER NOT NULL,
    "unitPriceSatang" INTEGER NOT NULL,
    "listPriceSatang" INTEGER,
    "minPriceSatang" INTEGER,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "discountSatang" BIGINT NOT NULL,
    "netSatang" BIGINT NOT NULL,
    "billShareSatang" BIGINT NOT NULL,
    "approvalReason" TEXT,

    CONSTRAINT "quotation_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_revision" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "pdfKey" TEXT,
    "sentAt" TIMESTAMPTZ(3) NOT NULL,
    "sentById" TEXT NOT NULL,

    CONSTRAINT "quotation_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_number_key" ON "quotation"("number");

-- CreateIndex
CREATE INDEX "quotation_ownerId_status_idx" ON "quotation"("ownerId", "status");

-- CreateIndex
CREATE INDEX "quotation_companyId_createdAt_idx" ON "quotation"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "quotation_customerId_idx" ON "quotation"("customerId");

-- CreateIndex
CREATE INDEX "quotation_status_validUntil_idx" ON "quotation"("status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_item_quotationId_position_key" ON "quotation_item"("quotationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_revision_quotationId_revision_key" ON "quotation_revision"("quotationId", "revision");

-- AddForeignKey
ALTER TABLE "doc_sequence" ADD CONSTRAINT "doc_sequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revision" ADD CONSTRAINT "quotation_revision_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database keeps even if application code is wrong
ALTER TABLE "doc_sequence" ADD CONSTRAINT "doc_sequence_positive_check" CHECK ("lastNumber" > 0 AND "yearMonth" ~ '^[0-9]{4}$');
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_amounts_check" CHECK (
  "revision" >= 0 AND "validityDays" BETWEEN 1 AND 365 AND "creditDays" BETWEEN 0 AND 365
  AND "subtotalSatang" >= 0 AND "billDiscountSatang" >= 0 AND "billDiscountSatang" <= "subtotalSatang"
  AND "afterDiscountSatang" = "subtotalSatang" - "billDiscountSatang"
  AND "vatRateBp" BETWEEN 0 AND 10000 AND "vatSatang" >= 0
  AND "totalSatang" = "afterDiscountSatang" + "vatSatang"
  AND "billDiscountValue" >= 0 AND ("billDiscountType" <> 'PERCENT' OR "billDiscountValue" <= 10000)
  AND "validUntil" >= "issueDate"
);
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_amounts_check" CHECK (
  "position" >= 0 AND "quantityMilli" > 0 AND "unitPriceSatang" >= 0
  AND "discountValue" >= 0 AND ("discountType" <> 'PERCENT' OR "discountValue" <= 10000)
  AND "discountSatang" >= 0 AND "netSatang" >= 0 AND "billShareSatang" >= 0 AND "billShareSatang" <= "netSatang"
  AND ("productId" IS NOT NULL OR "approvalReason" = 'customLine' OR "productCode" IS NOT NULL)
);
