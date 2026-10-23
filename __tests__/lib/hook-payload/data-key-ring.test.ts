/**
 * @jest-environment node
 *
 * LUM-1302 — per-workspace data keys, wrapped by ENCRYPTION_KEY.
 */
import { randomBytes } from 'crypto'
import {
  createDataKeyRing,
  type DataKeyStore,
  type StoredDataKey,
} from '@/lib/hook-payload/data-key-ring'

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex')
})
afterAll(() => {
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY
})

function memoryStore() {
  const rows: (StoredDataKey & { workspaceId: string })[] = []
  const calls = { findLatest: 0, findById: 0, create: 0 }
  const store: DataKeyStore = {
    async findLatest(workspaceId) {
      calls.findLatest++
      const own = rows.filter(r => r.workspaceId === workspaceId)
      return own.sort((a, b) => b.version - a.version)[0] ?? null
    },
    async findById(id) {
      calls.findById++
      return rows.find(r => r.id === id) ?? null
    },
    async create(workspaceId, version, wrappedKey) {
      calls.create++
      if (
        rows.some(r => r.workspaceId === workspaceId && r.version === version)
      )
        throw Object.assign(new Error('unique'), { code: 'P2002' })
      const row = {
        id: `dk_${rows.length + 1}`,
        workspaceId,
        version,
        wrappedKey,
      }
      rows.push(row)
      return row
    },
  }
  return { store, rows, calls }
}

describe('createDataKeyRing', () => {
  it('creates a workspace key on first use, wrapped, and reuses it', async () => {
    const { store, rows, calls } = memoryStore()
    const ring = createDataKeyRing(store)
    const a = await ring.activeKey('ws_a')
    expect(a.key).toHaveLength(32)
    expect(rows).toHaveLength(1)
    // Stored wrapped, never as the raw key.
    expect(rows[0]!.wrappedKey).not.toContain(a.key.toString('hex'))
    const again = await ring.activeKey('ws_a')
    expect(again).toBe(a)
    expect(calls.create).toBe(1)
    expect(calls.findLatest).toBe(1)
  })

  it('gives each workspace its own key', async () => {
    const ring = createDataKeyRing(memoryStore().store)
    const a = await ring.activeKey('ws_a')
    const b = await ring.activeKey('ws_b')
    expect(a.id).not.toBe(b.id)
    expect(a.key.equals(b.key)).toBe(false)
  })

  it('resolves a key by id from another instance (unwrapping the stored row)', async () => {
    const { store } = memoryStore()
    const writer = createDataKeyRing(store)
    const reader = createDataKeyRing(store)
    const a = await writer.activeKey('ws_a')
    const fetched = await reader.keyById(a.id)
    expect(fetched.key.equals(a.key)).toBe(true)
    await expect(reader.keyById('dk_missing')).rejects.toThrow(/not found/)
  })

  it('uses the winner when another instance created the first key concurrently', async () => {
    const { store, rows } = memoryStore()
    const first = createDataKeyRing(store)
    const second = createDataKeyRing(store)
    // `second` sees no key, then loses the create race to `first`.
    const findLatest = store.findLatest
    let hidden = true
    store.findLatest = async ws =>
      hidden ? ((hidden = false), null) : findLatest(ws)
    const winner = await first.activeKey('ws_a')
    hidden = true
    const loser = await second.activeKey('ws_a')
    expect(rows).toHaveLength(1)
    expect(loser.id).toBe(winner.id)
    expect(loser.key.equals(winner.key)).toBe(true)
  })

  it('picks up a newer key version after the active entry expires', async () => {
    const { store } = memoryStore()
    let t = 0
    const ring = createDataKeyRing(store, { now: () => t })
    const v1 = await ring.activeKey('ws_a')
    await store.create('ws_a', 2, (await store.findById(v1.id))!.wrappedKey)
    expect((await ring.activeKey('ws_a')).id).toBe(v1.id)
    t += 6 * 60 * 1000
    expect((await ring.activeKey('ws_a')).id).not.toBe(v1.id)
  })
})
