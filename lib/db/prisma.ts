import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

declare global {
  var prisma: PrismaClient | undefined
}

/** Replace deprecated sslmode values to suppress pg-connection-string warning. */
function sanitizeDbUrl(url: string): string {
  return url.replace(
    /sslmode=(prefer|require|verify-ca)/gi,
    'sslmode=verify-full'
  )
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: sanitizeDbUrl(process.env.DATABASE_URL!),
    ssl: { rejectUnauthorized: true },
  })
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })
}

export const prisma = global.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}
