-- Run once in Supabase → SQL Editor. Prisma cannot db push through the :6543 pooler.

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "twilioSid" TEXT,
  "twilioToken" TEXT,
  "twilioPhone" TEXT,
  "googleRefreshToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Lead" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', -- legacy composite
  "callStatus" TEXT NOT NULL DEFAULT 'pending', -- pending|calling|answered|not answered|call completed|call ended|failed
  "outcomeStatus" TEXT NOT NULL DEFAULT 'unknown', -- unknown|interested|follow up|visit scheduled|not interested
  "duration" TEXT,
  "summary" TEXT,
  "interested" BOOLEAN,
  "appointmentTime" TIMESTAMP(3),
  "transcription" TEXT,
  "recordingUrl" TEXT,
  "lastResponse" TEXT,
  "campaignId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- Existing DBs: add dual status columns (safe to re-run)
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "callStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "outcomeStatus" TEXT NOT NULL DEFAULT 'unknown';

-- Backfill from legacy single status where still at defaults
UPDATE "Lead" SET
  "callStatus" = CASE
    WHEN lower("status") IN ('interested','follow up','visit scheduled','not interested','not - interested','scheduled visit')
      THEN 'call completed'
    WHEN lower("status") IN ('pending','calling','answered','not answered','call completed','call ended','failed','completed','call complete')
      THEN CASE lower("status")
        WHEN 'completed' THEN 'call completed'
        WHEN 'call complete' THEN 'call completed'
        ELSE lower("status")
      END
    ELSE 'pending'
  END,
  "outcomeStatus" = CASE
    WHEN lower("status") IN ('interested') THEN 'interested'
    WHEN lower("status") IN ('follow up') THEN 'follow up'
    WHEN lower("status") IN ('visit scheduled','scheduled visit') THEN 'visit scheduled'
    WHEN lower("status") IN ('not interested','not - interested') THEN 'not interested'
    WHEN "interested" = true THEN 'interested'
    WHEN "interested" = false THEN 'not interested'
    ELSE 'unknown'
  END
WHERE "callStatus" = 'pending' AND "outcomeStatus" = 'unknown' AND lower("status") <> 'pending';


DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
