/**
 * @jest-environment node
 *
 * LUM-863: the keyring's data-key lifecycle and its cache — a batch read of
 * many encrypted rows must not unwrap the workspace key once per row.
 */
const store = new Map<
  string,
  {
    id: string
    workspaceId: string
    version: number
    kekId: string
    wrappedKey: string
  }
>()

jest.mock('@/lib/repositories/workspace-data-key.repository', () => ({
  workspaceDataKeyRepository: {
    findLatest: jest.fn(async (workspaceId: string) => {
      const rows = [...store.values()].filter(
        r => r.workspaceId === workspaceId
      )
      return rows.sort((a, b) => b.version - a.version)[0] ?? null
    }),
    findByIds: jest.fn(async (ids: string[]) =>
      ids.flatMap(id => (store.has(id) ? [store.get(id)!] : []))
    ),
    create: jest.fn(async (row: { id: string }) => {
      store.set(row.id, row as never)
      return true
    }),
  },
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/envelope-crypto/cipher', () => {
  const actual = jest.requireActual('@/lib/envelope-crypto/cipher')
  return { ...actual, unwrapDataKey: jest.fn(actual.unwrapDataKey) }
})

import { unwrapDataKey } from '@/lib/envelope-crypto/cipher'
import { workspaceKeyring } from '@/lib/envelope-crypto/workspace-keyring'
import { workspaceDataKeyRepository } from '@/lib/repositories/workspace-data-key.repository'
import { logger } from '@/lib/logger'
import {
  openHookPayloads,
  sealHookPayload,
} from '@/lib/hook-event/payload-cipher'

const KEKS = 'k1:' + 'c'.repeat(64)

beforeEach(() => {
  store.clear()
  jest.clearAllMocks()
  process.env.WORKSPACE_KEKS = KEKS
  workspaceKeyring.resetForTests()
})

afterAll(() => {
  delete process.env.WORKSPACE_KEKS
  workspaceKeyring.resetForTests()
})

describe('workspace keyring', () => {
  it('a batch read unwraps each data key only once', async () => {
    const rows = []
    for (let i = 0; i < 40; i++) {
      const sealed = await sealHookPayload('wsA', { n: i })
      rows.push({ id: `e${i}`, payloadEncrypted: sealed.payloadEncrypted })
    }
    // A fresh process: nothing cached.
    workspaceKeyring.resetForTests()
    process.env.WORKSPACE_KEKS = KEKS
    const unwrap = unwrapDataKey as jest.Mock
    unwrap.mockClear()
    const findByIds = workspaceDataKeyRepository.findByIds as jest.Mock
    findByIds.mockClear()

    const opened = await openHookPayloads(
      rows.map(r => ({
        id: r.id,
        workspaceId: 'wsA',
        payload: null,
        payloadEncrypted: r.payloadEncrypted,
      }))
    )
    expect(opened.map(r => r.payload)).toEqual(rows.map((_, i) => ({ n: i })))
    expect(opened[0]).not.toHaveProperty('payloadEncrypted')
    expect(unwrap).toHaveBeenCalledTimes(1)
    expect(findByIds).toHaveBeenCalledTimes(1)

    // A second read inside the cache window touches neither.
    await openHookPayloads([
      {
        id: 'again',
        workspaceId: 'wsA',
        payload: null,
        payloadEncrypted: rows[0]!.payloadEncrypted,
      },
    ])
    expect(unwrap).toHaveBeenCalledTimes(1)
    expect(findByIds).toHaveBeenCalledTimes(1)
  })

  it('creates one data key per workspace and stores it only wrapped', async () => {
    const a = await workspaceKeyring.getSealingKey('wsA')
    const again = await workspaceKeyring.getSealingKey('wsA')
    const b = await workspaceKeyring.getSealingKey('wsB')
    expect(again.id).toBe(a.id)
    expect(b.id).not.toBe(a.id)
    expect(b.key.equals(a.key)).toBe(false)
    expect(store.size).toBe(2)
    const stored = store.get(a.id)!
    expect(stored).toMatchObject({
      workspaceId: 'wsA',
      version: 1,
      kekId: 'k1',
    })
    expect(Buffer.from(stored.wrappedKey, 'base64').includes(a.key)).toBe(false)
  })

  it('stores plaintext when no KEK is configured and reads it back as-is', async () => {
    delete process.env.WORKSPACE_KEKS
    workspaceKeyring.resetForTests()
    const sealed = await sealHookPayload('wsA', { plain: true })
    expect(sealed).toEqual({ payload: { plain: true }, payloadEncrypted: null })
    expect(store.size).toBe(0)
    const [row] = await openHookPayloads([
      {
        id: 'p',
        workspaceId: 'wsA',
        payload: { plain: true },
        payloadEncrypted: null,
      },
    ])
    expect(row).toEqual({
      id: 'p',
      workspaceId: 'wsA',
      payload: { plain: true },
    })
  })

  it('reads a row whose data key is gone as a null payload', async () => {
    const sealed = await sealHookPayload('wsA', { gone: true })
    store.clear()
    workspaceKeyring.forgetWorkspace('wsA')
    const [row] = await openHookPayloads([
      {
        id: 'x',
        workspaceId: 'wsA',
        payload: null,
        payloadEncrypted: sealed.payloadEncrypted,
      },
    ])
    expect(row!.payload).toBeNull()
  })

  it('a ciphertext moved onto another workspace row does not decrypt', async () => {
    const sealed = await sealHookPayload('wsA', { secret: 'alpha' })
    await sealHookPayload('wsB', { other: true })
    const [moved, own] = await openHookPayloads([
      {
        id: 'moved',
        workspaceId: 'wsB',
        payload: null,
        payloadEncrypted: sealed.payloadEncrypted,
      },
      {
        id: 'own',
        workspaceId: 'wsA',
        payload: null,
        payloadEncrypted: sealed.payloadEncrypted,
      },
    ])
    expect(moved!.payload).toBeNull()
    expect(JSON.stringify(moved)).not.toContain('alpha')
    expect(own!.payload).toEqual({ secret: 'alpha' })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('workspace mismatch'),
      expect.anything()
    )
  })

  it('a data key whose KEK left the ring reads as null without failing the batch', async () => {
    const sealed = await sealHookPayload('wsA', { lost: true })
    // A process whose ring no longer carries k1 (a deploy misconfiguration).
    workspaceKeyring.resetForTests()
    process.env.WORKSPACE_KEKS = 'k2:' + 'd'.repeat(64)
    const sealedNew = await sealHookPayload('wsB', { fresh: true })

    const rows = await openHookPayloads([
      {
        id: 'lost',
        workspaceId: 'wsA',
        payload: null,
        payloadEncrypted: sealed.payloadEncrypted,
      },
      {
        id: 'fresh',
        workspaceId: 'wsB',
        payload: null,
        payloadEncrypted: sealedNew.payloadEncrypted,
      },
      {
        id: 'plain',
        workspaceId: 'wsA',
        payload: { plain: 1 },
        payloadEncrypted: null,
      },
    ])
    expect(rows.map(r => r.payload)).toEqual([
      null,
      { fresh: true },
      { plain: 1 },
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cannot be unwrapped'),
      expect.objectContaining({ kekId: 'k1' })
    )
  })
})
