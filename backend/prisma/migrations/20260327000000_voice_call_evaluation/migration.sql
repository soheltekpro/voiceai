-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_call_evaluation" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "strengths" TEXT NOT NULL,
    "improvements" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_call_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "voice_call_evaluation_callId_key" ON "voice_call_evaluation"("callId");
CREATE INDEX IF NOT EXISTS "voice_call_evaluation_workspaceId_idx" ON "voice_call_evaluation"("workspaceId");

-- AddForeignKey
ALTER TABLE "voice_call_evaluation" ADD CONSTRAINT "voice_call_evaluation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
