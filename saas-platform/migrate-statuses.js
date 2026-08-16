const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting comprehensive status migration...');

  // 1. Update all variations of 'Interested' to 'follow up'
  const followUpUpdate = await prisma.lead.updateMany({
    where: {
      status: {
        in: ['Interested', 'INTERESTED', 'interested', 'Follow up', 'FOLLOW UP']
      }
    },
    data: {
      status: 'follow up'
    }
  });
  console.log(`Updated ${followUpUpdate.count} leads to 'follow up'.`);

  // 2. Update all variations of 'Not Interested' to 'not - interested'
  const notInterestedUpdate = await prisma.lead.updateMany({
    where: {
      status: {
        in: ['Not Interested', 'NOT INTERESTED', 'not interested', 'Not interested', 'not - interested']
      }
    },
    data: {
      status: 'not - interested'
    }
  });
  console.log(`Updated ${notInterestedUpdate.count} leads to 'not - interested'.`);

  // 3. Update all variations of 'Scheduled' to 'visit scheduled'
  const scheduledUpdate = await prisma.lead.updateMany({
    where: {
      status: {
        in: ['Scheduled', 'SCHEDULED', 'scheduled', 'Scheduled visit', 'SCHEDULED VISIT', 'scheduled visit', 'visit scheduled']
      }
    },
    data: {
      status: 'visit scheduled'
    }
  });
  console.log(`Updated ${scheduledUpdate.count} leads to 'visit scheduled'.`);

  console.log('Migration completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
