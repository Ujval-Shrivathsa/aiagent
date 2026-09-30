import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const result = await prisma.lead.updateMany({
  where: { status: { in: ['calling', 'answered'] } },
  data: {
    status: 'not answered',
    callStatus: 'not answered',
    outcomeStatus: 'unknown',
  },
});

console.log(`Reset ${result.count} stuck lead(s) to not answered`);
await prisma.$disconnect();
