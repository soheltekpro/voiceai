-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('PER_MINUTE', 'PER_TOKEN', 'PER_CHARACTER');

-- CreateTable
CREATE TABLE IF NOT EXISTS "provider_pricing" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "pricingType" "PricingType" NOT NULL,
    "pricePerUnit" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "provider_pricing_providerName_pricingType_key" ON "provider_pricing"("providerName", "pricingType");
CREATE INDEX IF NOT EXISTS "provider_pricing_providerName_idx" ON "provider_pricing"("providerName");

-- AlterTable: add cost columns to voice_usage
ALTER TABLE "voice_usage" ADD COLUMN IF NOT EXISTS "sttCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "voice_usage" ADD COLUMN IF NOT EXISTS "llmCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "voice_usage" ADD COLUMN IF NOT EXISTS "ttsCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "voice_usage" ADD COLUMN IF NOT EXISTS "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
