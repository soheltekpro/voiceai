-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_prompt_optimization" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_prompt_optimization_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "voice_prompt_optimization_workspaceId_idx" ON "voice_prompt_optimization"("workspaceId");
CREATE INDEX IF NOT EXISTS "voice_prompt_optimization_agentId_idx" ON "voice_prompt_optimization"("agentId");

ALTER TABLE "voice_prompt_optimization" ADD CONSTRAINT "voice_prompt_optimization_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
