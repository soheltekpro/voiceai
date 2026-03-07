-- AlterTable: Call - add recordingEnabled, recordingDuration
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingDuration" INTEGER;

-- CallEventType enum: add new values (run once; omit if values already exist)
ALTER TYPE "CallEventType" ADD VALUE 'AGENT_SPEAKING';
ALTER TYPE "CallEventType" ADD VALUE 'AGENT_FINISHED';
ALTER TYPE "CallEventType" ADD VALUE 'RECORDING_AVAILABLE';
ALTER TYPE "CallEventType" ADD VALUE 'HANDOFF_REQUESTED';

-- ToolType enum
ALTER TYPE "ToolType" ADD VALUE 'HUMAN_HANDOFF';
