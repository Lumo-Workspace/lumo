import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { withSoftDelete } from './soft-delete'
import { resolveDatabaseUrl } from './database-url'

declare global {
  var prisma: PrismaClient | undefined
}

/** Replace deprecated sslmode values to suppress pg-connection-string warning. */
function sanitizeDbUrl(url: string): string {
  if (!url) return url
  return url.replace(
    /sslmode=(prefer|require|verify-ca)/gi,
    'sslmode=verify-full'
  )
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: sanitizeDbUrl(resolveDatabaseUrl('pooled') ?? ''),
    ssl: { rejectUnauthorized: true },
  })
  // LUM-918: tasks / documents in the trash are invisible to default reads.
  return withSoftDelete(
    new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    })
  )
}

export const prisma = global.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}
