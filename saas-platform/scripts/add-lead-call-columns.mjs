import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
});

try {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "calledFrom" TEXT',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastCalledAt" TIMESTAMP(3)',
  );
  console.log('Lead call-tracking columns ready.');
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
