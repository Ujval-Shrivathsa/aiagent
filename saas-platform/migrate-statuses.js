/**
 * One-time / ops helper: normalize legacy lead status strings to the
 * canonical lifecycle values in src/lib/lead-status.ts.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const mappings = [
    { from: ['Follow up', 'FOLLOW UP', 'Follow Up'], to: 'follow up' },
    { from: ['not - interested', 'Not Interested', 'NOT INTERESTED', 'Not interested'], to: 'not interested' },
    { from: ['Scheduled', 'SCHEDULED', 'scheduled', 'Scheduled visit', 'SCHEDULED VISIT', 'scheduled visit'], to: 'visit scheduled' },
    { from: ['completed', 'Completed', 'call complete'], to: 'call completed' },
    { from: ['idle', 'Idle'], to: 'pending' },
  ];

  for (const { from, to } of mappings) {
    const result = await prisma.lead.updateMany({
      where: { status: { in: from } },
      data: { status: to },
    });
    console.log(`→ ${to}: ${result.count} rows`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
