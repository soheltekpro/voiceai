-- CreateTable
CREATE TABLE IF NOT EXISTS "billing_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "billing_events_workspaceId_idx" ON "billing_events"("workspaceId");
CREATE INDEX IF NOT EXISTS "billing_events_eventType_idx" ON "billing_events"("eventType");
CREATE INDEX IF NOT EXISTS "billing_events_createdAt_idx" ON "billing_events"("createdAt");

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
