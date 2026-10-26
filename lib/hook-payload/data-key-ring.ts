/**
 * LUM-1302 — per-workspace data keys for HookEvent payload encryption
 * (envelope encryption). Each workspace gets a random 32-byte key the first
 * time it writes a payload; the key is stored wrapped by ENCRYPTION_KEY
 * (lib/crypto.ts), so the database alone never yields it.
 *
 * Unwrapped keys are cached in memory: a key never changes once created, and
 * the "latest key of a workspace" entry expires so a newly added version is
 * picked up by every instance within ACTIVE_TTL_MS.
 */
import { randomBytes } from 'crypto'
import { decrypt, encrypt } from '@/lib/crypto'
import { isPrismaUniqueViolation } from '@/lib/db/errors'
import type { DataKey } from '@/lib/hook-payload/seal'

export interface StoredDataKey {
  id: string
  version: number
  wrappedKey: string
}

export interface DataKeyStore {
  findLatest(workspaceId: string): Promise<StoredDataKey | null>
  findById(id: string): Promise<StoredDataKey | null>
  create(
    workspaceId: string,
    version: number,
    wrappedKey: string
  ): Promise<StoredDataKey>
}

export interface DataKeyRing {
  /** The key new payloads of `workspaceId` are sealed with; created on first use. */
  activeKey(workspaceId: string): Promise<DataKey>
  /** The key a sealed payload names. Throws when it does not exist. */
  keyById(id: string): Promise<DataKey>
}

const ACTIVE_TTL_MS = 5 * 60 * 1000
/** Unwrapped keys kept per instance; past it the oldest are dropped. */
const MAX_CACHED_KEYS = 1000

export interface DataKeyRingOptions {
  now?: () => number
}

export function createDataKeyRing(
  store: DataKeyStore,
  options: DataKeyRingOptions = {}
): DataKeyRing {
  const now = options.now ?? Date.now
  const byId = new Map<string, DataKey>()
  const active = new Map<string, { keyId: string; expiresAt: number }>()

  function unwrap(stored: StoredDataKey): DataKey {
    const cached = byId.get(stored.id)
    if (cached) return cached
    const key: DataKey = {
      id: stored.id,
      key: Buffer.from(decrypt(stored.wrappedKey), 'hex'),
    }
    if (key.key.length !== 32)
      throw new Error(`Workspace data key ${stored.id} is not 32 bytes`)
    if (byId.size >= MAX_CACHED_KEYS) {
      const oldest = byId.keys().next().value
      if (oldest !== undefined) byId.delete(oldest)
    }
    byId.set(stored.id, key)
    return key
  }

  async function createFirstKey(workspaceId: string): Promise<StoredDataKey> {
    try {
      return await store.create(
        workspaceId,
        1,
        encrypt(randomBytes(32).toString('hex'))
      )
    } catch (error) {
      // Another writer created it first: use theirs.
      if (!isPrismaUniqueViolation(error)) throw error
      const winner = await store.findLatest(workspaceId)
      if (!winner) throw error
      return winner
    }
  }

  return {
    async activeKey(workspaceId) {
      const hit = active.get(workspaceId)
      if (hit && hit.expiresAt > now()) {
        const key = byId.get(hit.keyId)
        if (key) return key
      }
      const stored =
        (await store.findLatest(workspaceId)) ??
        (await createFirstKey(workspaceId))
      const key = unwrap(stored)
      active.set(workspaceId, {
        keyId: key.id,
        expiresAt: now() + ACTIVE_TTL_MS,
      })
      return key
    },

    async keyById(id) {
      const cached = byId.get(id)
      if (cached) return cached
      const stored = await store.findById(id)
      if (!stored) throw new Error(`Workspace data key ${id} not found`)
      return unwrap(stored)
    },
  }
}
