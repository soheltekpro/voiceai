-- CreateTable: voice usage metering for billing
CREATE TABLE IF NOT EXISTS "voice_usage" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "audioInputSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "audioOutputSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "llmInputTokens" INTEGER NOT NULL DEFAULT 0,
    "llmOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "ttsCharacters" INTEGER NOT NULL DEFAULT 0,
    "sttProvider" TEXT,
    "llmProvider" TEXT,
    "ttsProvider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_usage_workspaceId_idx" ON "voice_usage"("workspaceId");
CREATE INDEX IF NOT EXISTS "voice_usage_workspaceId_endedAt_idx" ON "voice_usage"("workspaceId", "endedAt");

-- AddForeignKey
ALTER TABLE "voice_usage" ADD CONSTRAINT "voice_usage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
