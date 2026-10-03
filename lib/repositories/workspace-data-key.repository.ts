import { prisma } from '@/lib/db/prisma'

/** A stored (wrapped) workspace data key — never the raw key. */
export interface StoredDataKey {
  id: string
  workspaceId: string
  version: number
  kekId: string
  wrappedKey: string
}

const SELECT = {
  id: true,
  workspaceId: true,
  version: true,
  kekId: true,
  wrappedKey: true,
} as const

// ── WorkspaceDataKey Repository (LUM-863) ───────────────────────────────────

export const workspaceDataKeyRepository = {
  /** The workspace's newest data key (the one that seals new data), if any. */
  async findLatest(workspaceId: string): Promise<StoredDataKey | null> {
    return prisma.workspaceDataKey.findFirst({
      where: { workspaceId },
      orderBy: { version: 'desc' },
      select: SELECT,
    })
  },

  /** Data keys by id (any workspace); missing ids are simply absent. */
  async findByIds(ids: string[]): Promise<StoredDataKey[]> {
    if (ids.length === 0) return []
    return prisma.workspaceDataKey.findMany({
      where: { id: { in: ids } },
      select: SELECT,
    })
  },

  /**
   * Insert a data key. Returns false when another writer already created this
   * workspace's `version` (unique violation) — the caller re-reads the winner.
   */
  async create(key: StoredDataKey): Promise<boolean> {
    try {
      await prisma.workspaceDataKey.create({ data: key, select: { id: true } })
      return true
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code === 'P2002') return false
      throw error
    }
  },
}
