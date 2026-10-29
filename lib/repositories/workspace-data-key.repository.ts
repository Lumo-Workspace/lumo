import type { PrismaClient } from '@prisma/client'
import type {
  DataKeyStore,
  StoredDataKey,
} from '@/lib/hook-payload/data-key-ring'

const SELECT = { id: true, version: true, wrappedKey: true } as const

/**
 * LUM-1302 — WorkspaceDataKey rows. A factory over a given client, not a
 * module bound to `@/lib/db/prisma`: the payload-encryption extension that
 * client is built with needs this store first, so it is handed the plain
 * (unextended) client.
 */
export function createWorkspaceDataKeyStore(
  client: PrismaClient
): DataKeyStore {
  return {
    async findLatest(workspaceId: string): Promise<StoredDataKey | null> {
      return client.workspaceDataKey.findFirst({
        where: { workspaceId },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    async findById(id: string): Promise<StoredDataKey | null> {
      return client.workspaceDataKey.findUnique({
        where: { id },
        select: SELECT,
      })
    },

    /** Throws P2002 when another writer created this version first. */
    async create(
      workspaceId: string,
      version: number,
      wrappedKey: string
    ): Promise<StoredDataKey> {
      return client.workspaceDataKey.create({
        data: { workspaceId, version, wrappedKey },
        select: SELECT,
      })
    },
  }
}
