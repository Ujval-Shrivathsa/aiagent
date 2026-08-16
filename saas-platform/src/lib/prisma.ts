import { PrismaClient } from '@prisma/client'

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL || ''
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL || ''
  const onVercel = process.env.VERCEL === '1'

  if (onVercel || databaseUrl.startsWith('postgres')) {
    if (supabaseUrl && !supabaseUrl.includes('YOUR_DB_PASSWORD')) return supabaseUrl
    if (databaseUrl.startsWith('postgres') && !databaseUrl.includes('YOUR_DB_PASSWORD')) return databaseUrl
  }

  if (databaseUrl && !databaseUrl.startsWith('file:')) return databaseUrl
  return databaseUrl
}

export function getDatabaseConfigError(): string | null {
  const url = resolveDatabaseUrl()
  if (!url || url.startsWith('file:') || url.includes('YOUR_DB_PASSWORD')) {
    return 'Vercel cannot use SQLite. In Vercel → Settings → Environment Variables set DATABASE_URL (and optionally SUPABASE_DATABASE_URL) to the Supabase Postgres URI from Project Settings → Database → URI. Replace YOUR_DB_PASSWORD with the database password.'
  }
  return null
}

const prismaClientSingleton = () => {
  const url = resolveDatabaseUrl()
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined)
}

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

export { prisma }
export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
