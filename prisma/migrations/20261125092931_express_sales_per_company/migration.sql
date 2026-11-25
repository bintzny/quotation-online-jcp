-- CreateTable
CREATE TABLE "customer_express_sale" (
    "customerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lastSaleDate" DATE NOT NULL,
    "sales12mSatang" BIGINT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_express_sale_pkey" PRIMARY KEY ("customerId","companyId")
);

-- AddForeignKey
ALTER TABLE "customer_express_sale" ADD CONSTRAINT "customer_express_sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_express_sale" ADD CONSTRAINT "customer_express_sale_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Added by hand ──
ALTER TABLE "customer_express_sale" ADD CONSTRAINT "express_sale_not_negative" CHECK ("sales12mSatang" IS NULL OR "sales12mSatang" >= 0);
