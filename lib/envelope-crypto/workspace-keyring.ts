/**
 * LUM-863 — per-workspace data keys (server-only).
 *
 * Each workspace has a random 256-bit data key (DEK), stored only wrapped by a
 * key-encryption key (KEK) from the `WORKSPACE_KEKS` env ring
 * (`"<kekId>:<64 hex>[,<kekId>:<64 hex>…]"`; the first entry wraps new DEKs,
 * the rest only unwrap — that is how a KEK is rotated). The KEK source sits
 * behind `kekRing()` so a KMS-backed ring can replace the env later.
 *
 * Unwrapped DEKs are cached in-process for a few minutes, so a timeline that
 * reads hundreds of events unwraps each key once, not once per row. Deleting a
 * workspace deletes its WorkspaceDataKey rows (FK cascade) — crypto-shredding
 * every ciphertext they sealed; `forgetWorkspace` drops this process's copy.
 */
import { randomUUID } from 'crypto'
import {
  dataKeyAad,
  generateDataKey,
  parseKekRing,
  unwrapDataKey,
  wrapDataKey,
  type Kek,
} from '@/lib/envelope-crypto/cipher'
import {
  workspaceDataKeyRepository,
  type StoredDataKey,
} from '@/lib/repositories/workspace-data-key.repository'

export interface DataKey {
  id: string
  workspaceId: string
  key: Buffer
}

const CACHE_TTL_MS = 5 * 60 * 1000

let parsedRaw: string | undefined
let parsedRing: Kek[] = []
const keysById = new Map<string, { key: DataKey; expiresAt: number }>()
const latestByWorkspace = new Map<string, { id: string; expiresAt: number }>()

/** The KEK ring, parsed from the env (re-parsed only when the env changes). */
function kekRing(): Kek[] {
  const raw = process.env.WORKSPACE_KEKS
  if (raw !== parsedRaw) {
    parsedRing = parseKekRing(raw)
    parsedRaw = raw
  }
  return parsedRing
}

function unwrap(stored: StoredDataKey): DataKey {
  const kek = kekRing().find(k => k.id === stored.kekId)
  if (!kek) {
    throw new Error(
      `WORKSPACE_KEKS has no KEK "${stored.kekId}" — data key ${stored.id} cannot be unwrapped`
    )
  }
  const key = unwrapDataKey(
    kek,
    stored.wrappedKey,
    dataKeyAad(stored.workspaceId, stored.id)
  )
  const dataKey = { id: stored.id, workspaceId: stored.workspaceId, key }
  keysById.set(stored.id, {
    key: dataKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
  return dataKey
}

function cachedById(id: string): DataKey | null {
  const hit = keysById.get(id)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    keysById.delete(id)
    return null
  }
  return hit.key
}

export const workspaceKeyring = {
  /** True when a KEK is configured — new data can be sealed. */
  isEnabled(): boolean {
    return kekRing().length > 0
  },

  /**
   * The workspace's current sealing key, created (version 1) on first use.
   * Concurrent first writers race on the (workspaceId, version) unique key;
   * the loser re-reads and uses the winner's key.
   */
  async getSealingKey(workspaceId: string): Promise<DataKey> {
    const ring = kekRing()
    const primary = ring[0]
    if (!primary) throw new Error('WORKSPACE_KEKS is not configured')

    const latest = latestByWorkspace.get(workspaceId)
    if (latest && latest.expiresAt > Date.now()) {
      const hit = cachedById(latest.id)
      if (hit) return hit
    }

    let stored = await workspaceDataKeyRepository.findLatest(workspaceId)
    if (!stored) {
      const id = randomUUID()
      const candidate: StoredDataKey = {
        id,
        workspaceId,
        version: 1,
        kekId: primary.id,
        wrappedKey: wrapDataKey(
          primary,
          generateDataKey(),
          dataKeyAad(workspaceId, id)
        ),
      }
      const created = await workspaceDataKeyRepository.create(candidate)
      stored = created
        ? candidate
        : await workspaceDataKeyRepository.findLatest(workspaceId)
      if (!stored) throw new Error('Workspace data key vanished after create')
    }
    const key = cachedById(stored.id) ?? unwrap(stored)
    latestByWorkspace.set(workspaceId, {
      id: stored.id,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
    return key
  },

  /**
   * Data keys by id, unwrapped. One repository read for all cache misses; ids
   * with no stored key (e.g. a deleted workspace) are absent from the map.
   */
  async getKeysByIds(ids: Iterable<string>): Promise<Map<string, DataKey>> {
    const out = new Map<string, DataKey>()
    const misses: string[] = []
    for (const id of new Set(ids)) {
      const hit = cachedById(id)
      if (hit) out.set(id, hit)
      else misses.push(id)
    }
    if (misses.length > 0) {
      for (const stored of await workspaceDataKeyRepository.findByIds(misses)) {
        out.set(stored.id, unwrap(stored))
      }
    }
    return out
  },

  /** Drop this process's cached keys of a workspace (after its deletion). */
  forgetWorkspace(workspaceId: string): void {
    latestByWorkspace.delete(workspaceId)
    for (const [id, entry] of keysById) {
      if (entry.key.workspaceId === workspaceId) keysById.delete(id)
    }
  },

  /** Test hook: forget every cached key and the parsed ring. */
  resetForTests(): void {
    keysById.clear()
    latestByWorkspace.clear()
    parsedRaw = undefined
    parsedRing = []
  },
}
