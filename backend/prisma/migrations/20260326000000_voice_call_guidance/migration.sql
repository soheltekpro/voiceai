-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_call_guidance" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_call_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_call_guidance_callId_idx" ON "voice_call_guidance"("callId");

-- AddForeignKey
ALTER TABLE "voice_call_guidance" ADD CONSTRAINT "voice_call_guidance_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
