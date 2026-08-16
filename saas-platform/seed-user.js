const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;');
  console.log('WAL enabled!');
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log('No user found. Creating a default user...');
    await prisma.user.create({
      data: {
        email: 'avacadonujval@gmail.com',
        name: 'Ujval'
      }
    });
    console.log('User created!');
  } else {
    console.log('Users already exist.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());