-- Add stripeEventId (nullable first for backfill)
ALTER TABLE "billing_events" ADD COLUMN IF NOT EXISTS "stripeEventId" TEXT;

-- Backfill existing rows with unique values (use id so existing rows remain unique)
UPDATE "billing_events" SET "stripeEventId" = "id" WHERE "stripeEventId" IS NULL;

-- Enforce NOT NULL and UNIQUE
ALTER TABLE "billing_events" ALTER COLUMN "stripeEventId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_stripeEventId_key" ON "billing_events"("stripeEventId");
