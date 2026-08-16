const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      name: true,
      status: true
    }
  });
  console.log('Leads:', leads);
}

main().catch(console.error).finally(() => prisma.$disconnect());
