import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * Run a set of repository writes atomically.
 *
 * Services depend on this instead of importing the Prisma client directly
 * (CLAUDE.md layered architecture: the Service layer must not access Prisma).
 * The callback receives a transaction client to thread into repository methods'
 * optional `tx` parameter.
 */
export function runInTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn)
}
