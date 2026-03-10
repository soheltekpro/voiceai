-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_call_outcome" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_call_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "voice_call_outcome_callId_key" ON "voice_call_outcome"("callId");
CREATE INDEX IF NOT EXISTS "voice_call_outcome_workspaceId_idx" ON "voice_call_outcome"("workspaceId");
CREATE INDEX IF NOT EXISTS "voice_call_outcome_outcome_idx" ON "voice_call_outcome"("outcome");

-- AddForeignKey
ALTER TABLE "voice_call_outcome" ADD CONSTRAINT "voice_call_outcome_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
