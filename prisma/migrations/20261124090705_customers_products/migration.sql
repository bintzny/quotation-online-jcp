-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('JURISTIC', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'PENDING_OWNER', 'LOST');

-- CreateEnum
CREATE TYPE "OwnerChangeReason" AS ENUM ('CREATED', 'IMPORT', 'QUOTE_CLAIM', 'TRANSFER', 'PENDING_RESOLVED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'PRODUCTS');

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "branchCode" TEXT NOT NULL DEFAULT '00000',
    "branchName" TEXT,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "lastPurchaseDate" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_owner_history" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "reason" "OwnerChangeReason" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_owner_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_owner_candidate" (
    "customerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_owner_candidate_pkey" PRIMARY KEY ("customerId","userId")
);

-- CreateTable
CREATE TABLE "customer_express_code" (
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "customer_express_code_pkey" PRIMARY KEY ("companyId","code")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "listPriceSatang" INTEGER NOT NULL,
    "minPriceSatang" INTEGER,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "companyId" TEXT,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_ownerId_idx" ON "customer"("ownerId");

-- CreateIndex
CREATE INDEX "customer_status_idx" ON "customer"("status");

-- CreateIndex
CREATE INDEX "customer_name_idx" ON "customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_taxId_branchCode_key" ON "customer"("taxId", "branchCode");

-- CreateIndex
CREATE INDEX "customer_contact_customerId_idx" ON "customer_contact"("customerId");

-- CreateIndex
CREATE INDEX "customer_owner_history_customerId_changedAt_idx" ON "customer_owner_history"("customerId", "changedAt");

-- CreateIndex
CREATE INDEX "customer_express_code_customerId_idx" ON "customer_express_code"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "product_code_key" ON "product"("code");

-- CreateIndex
CREATE INDEX "product_category_idx" ON "product"("category");

-- CreateIndex
CREATE INDEX "import_batch_createdAt_idx" ON "import_batch"("createdAt");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_owner_history" ADD CONSTRAINT "customer_owner_history_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_owner_candidate" ADD CONSTRAINT "customer_owner_candidate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_owner_candidate" ADD CONSTRAINT "customer_owner_candidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_express_code" ADD CONSTRAINT "customer_express_code_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_express_code" ADD CONSTRAINT "customer_express_code_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database itself, in addition to app validation.
ALTER TABLE "product" ADD CONSTRAINT "product_prices_check" CHECK (
  "listPriceSatang" >= 0
  AND ("minPriceSatang" IS NULL OR ("minPriceSatang" >= 0 AND "minPriceSatang" <= "listPriceSatang"))
  AND ("isService" OR "minPriceSatang" IS NOT NULL)
);
ALTER TABLE "customer" ADD CONSTRAINT "customer_juristic_taxid_check" CHECK (
  "type" <> 'JURISTIC' OR "taxId" IS NOT NULL
);
ALTER TABLE "customer" ADD CONSTRAINT "customer_taxid_format_check" CHECK (
  "taxId" IS NULL OR "taxId" ~ '^[0-9]{13}$'
);
ALTER TABLE "customer" ADD CONSTRAINT "customer_branch_format_check" CHECK ("branchCode" ~ '^[0-9]{5}$');
