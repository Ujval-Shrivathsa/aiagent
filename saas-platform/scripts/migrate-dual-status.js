require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '../.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "callStatus" TEXT NOT NULL DEFAULT \'pending\''
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "outcomeStatus" TEXT NOT NULL DEFAULT \'unknown\''
  );
  await prisma.$executeRawUnsafe(`
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
WHERE "callStatus" = 'pending' AND "outcomeStatus" = 'unknown' AND lower("status") <> 'pending'
  `);
  const sample = await prisma.lead.findMany({
    take: 5,
    select: { name: true, status: true, callStatus: true, outcomeStatus: true },
  });
  console.log('migrated ok', sample);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
