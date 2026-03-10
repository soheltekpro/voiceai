-- AlterTable: add sttModel, ttsVoice for provider routing
ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "sttModel" TEXT;
ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "ttsVoice" TEXT;
