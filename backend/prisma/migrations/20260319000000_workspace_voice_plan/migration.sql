-- CreateTable: voice quota per workspace (monthly limits)
CREATE TABLE IF NOT EXISTS "workspace_voice_plan" (
    "workspaceId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "monthlyCallMinutes" INTEGER NOT NULL DEFAULT 0,
    "monthlyLLMTokens" INTEGER NOT NULL DEFAULT 0,
    "monthlyTTSCharacters" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_voice_plan_pkey" PRIMARY KEY ("workspaceId")
);

-- AddForeignKey
ALTER TABLE "workspace_voice_plan" ADD CONSTRAINT "workspace_voice_plan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
