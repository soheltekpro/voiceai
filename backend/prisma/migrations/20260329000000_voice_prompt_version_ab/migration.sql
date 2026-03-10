-- VoicePromptVersion table for A/B testing
CREATE TABLE IF NOT EXISTS "voice_prompt_version" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "trafficShare" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_prompt_version_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "voice_prompt_version_workspaceId_idx" ON "voice_prompt_version"("workspaceId");
CREATE INDEX IF NOT EXISTS "voice_prompt_version_agentId_idx" ON "voice_prompt_version"("agentId");

ALTER TABLE "voice_prompt_version" ADD CONSTRAINT "voice_prompt_version_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add promptVersionId to calls
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "promptVersionId" TEXT;
CREATE INDEX IF NOT EXISTS "calls_promptVersionId_idx" ON "calls"("promptVersionId");

-- Add promptVersionId to call_sessions
ALTER TABLE "call_sessions" ADD COLUMN IF NOT EXISTS "promptVersionId" TEXT;
CREATE INDEX IF NOT EXISTS "call_sessions_promptVersionId_idx" ON "call_sessions"("promptVersionId");

-- Add promptVersionId to voice_call_outcome
ALTER TABLE "voice_call_outcome" ADD COLUMN IF NOT EXISTS "promptVersionId" TEXT;
CREATE INDEX IF NOT EXISTS "voice_call_outcome_promptVersionId_idx" ON "voice_call_outcome"("promptVersionId");
