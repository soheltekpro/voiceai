-- AlterTable
ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "llmModel" TEXT;
ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "temperature" DOUBLE PRECISION;
