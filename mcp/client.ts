import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { withSoftDelete } from '../lib/db/soft-delete'

/**
 * The legacy stdio MCP's PrismaClient. LUM-923: it carries the same trash
 * filter as the app client, so list / lookup tools never surface tasks or
 * documents in the trash.
 */
export function createMcpClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    ssl: { rejectUnauthorized: true },
  })
  return withSoftDelete(new PrismaClient({ adapter }))
}
