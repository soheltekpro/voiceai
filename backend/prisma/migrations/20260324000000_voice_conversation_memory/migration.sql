-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_conversation_memory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "lastCallId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_conversation_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "voice_conversation_memory_workspaceId_phoneNumber_key" ON "voice_conversation_memory"("workspaceId", "phoneNumber");
CREATE INDEX IF NOT EXISTS "voice_conversation_memory_workspaceId_phoneNumber_idx" ON "voice_conversation_memory"("workspaceId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "voice_conversation_memory" ADD CONSTRAINT "voice_conversation_memory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
