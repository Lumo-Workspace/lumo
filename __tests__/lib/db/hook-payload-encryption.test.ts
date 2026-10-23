/**
 * @jest-environment node
 *
 * LUM-1302 — the HookEvent query extension's argument and result handling,
 * without a database (the real-Postgres suite covers it end to end).
 */
import { randomBytes } from 'crypto'
import { restoreEnv } from '../../helpers/restore-env'
import {
  assertNoPayloadFilter,
  runHookEventOperation,
  type HookPayloadEncryptionDeps,
} from '@/lib/db/hook-payload-encryption'
import { isSealedPayload, type DataKey } from '@/lib/hook-payload/seal'
import { isEncryptionKeyConfigured } from '@/lib/crypto'

function deps(enabled = true): HookPayloadEncryptionDeps & {
  keys: Map<string, DataKey>
} {
  const keys = new Map<string, DataKey>()
  return {
    keys,
    enabled: () => enabled,
    ring: {
      async activeKey(workspaceId) {
        const id = `dk_${workspaceId}`
        if (!keys.has(id)) keys.set(id, { id, key: randomBytes(32) })
        return keys.get(id)!
      },
      async keyById(id) {
        const key = keys.get(id)
        if (!key) throw new Error('missing')
        return key
      },
    },
  }
}

/** A `query` that stores what it was given and echoes it back as the row(s). */
function echoQuery() {
  const calls: Record<string, unknown>[] = []
  const query = async (args: unknown) => {
    const a = args as Record<string, unknown>
    calls.push(a)
    if (Array.isArray(a.data)) return a.data.map(d => ({ ...d }))
    return { ...((a.data ?? a.create) as object) }
  }
  return { calls, query }
}

describe('runHookEventOperation', () => {
  it('seals a create with its workspace key and hands the caller plain JSON back', async () => {
    const d = deps()
    const { calls, query } = echoQuery()
    const result = await runHookEventOperation(
      {
        operation: 'create',
        args: { data: { workspaceId: 'ws1', payload: { a: 1 } } },
        query,
      },
      d
    )
    const sent = calls[0]!.data as Record<string, unknown>
    expect(isSealedPayload(sent.payload)).toBe(true)
    expect(sent.payloadKeyId).toBe('dk_ws1')
    expect((result as { payload: unknown }).payload).toEqual({ a: 1 })
  })

  it('seals each createMany row with its own workspace', async () => {
    const d = deps()
    const { calls, query } = echoQuery()
    await runHookEventOperation(
      {
        operation: 'createMany',
        args: {
          data: [
            { workspaceId: 'ws1', payload: { a: 1 } },
            { workspace: { connect: { id: 'ws2' } }, payload: { b: 2 } },
          ],
        },
        query,
      },
      d
    )
    const data = calls[0]!.data as Record<string, unknown>[]
    expect(data.map(r => r.payloadKeyId)).toEqual(['dk_ws1', 'dk_ws2'])
  })

  it('refuses a payload write that names no workspace', async () => {
    const { query } = echoQuery()
    await expect(
      runHookEventOperation(
        { operation: 'create', args: { data: { payload: {} } }, query },
        deps()
      )
    ).rejects.toThrow(/names no workspace/)
    await expect(
      runHookEventOperation(
        {
          operation: 'upsert',
          args: {
            where: { id: 'e1' },
            create: { workspaceId: 'ws1', payload: {} },
            update: { payload: {} },
          },
          query,
        },
        deps()
      )
    ).rejects.toThrow(/where.workspaceId/)
  })

  it('leaves writes that do not touch payload alone', async () => {
    const { calls, query } = echoQuery()
    await runHookEventOperation(
      {
        operation: 'updateMany',
        args: { where: { id: 'e1' }, data: { taskId: 't1' } },
        query,
      },
      deps()
    )
    expect(calls[0]).toEqual({ where: { id: 'e1' }, data: { taskId: 't1' } })
  })

  it('writes plaintext when encryption is off', async () => {
    const { calls, query } = echoQuery()
    await runHookEventOperation(
      {
        operation: 'create',
        args: { data: { workspaceId: 'ws1', payload: { a: 1 } } },
        query,
      },
      deps(false)
    )
    expect((calls[0]!.data as Record<string, unknown>).payload).toEqual({
      a: 1,
    })
  })

  it('opens sealed payloads in a findMany result and passes plaintext through', async () => {
    const d = deps()
    const sealed = await runHookEventOperation(
      {
        operation: 'create',
        args: { data: { workspaceId: 'ws1', payload: { a: 1 } } },
        query: async args => ({ ...(args as { data: object }).data }),
      },
      {
        ...d,
        ring: {
          ...d.ring,
          keyById: async () => ({ id: 'x', key: Buffer.alloc(32) }),
        },
      }
    )
    // Wrong key on read: unreadable, never ciphertext.
    expect((sealed as { payload: unknown }).payload).toEqual({
      _lumo_unreadable: true,
    })

    const stored: unknown[] = []
    await runHookEventOperation(
      {
        operation: 'create',
        args: { data: { workspaceId: 'ws1', payload: { a: 1 } } },
        query: async args => {
          stored.push({ ...(args as { data: object }).data })
          return { id: 'e1' }
        },
      },
      d
    )
    const rows = await runHookEventOperation(
      {
        operation: 'findMany',
        args: { select: { payload: true } },
        query: async () => [
          { payload: (stored[0] as { payload: unknown }).payload },
          { payload: { legacy: true } },
        ],
      },
      d
    )
    expect(rows).toEqual([{ payload: { a: 1 } }, { payload: { legacy: true } }])
  })
})

describe('assertNoPayloadFilter', () => {
  it('refuses payload filters at any AND / OR / NOT depth', () => {
    expect(() => assertNoPayloadFilter({ payload: { equals: {} } })).toThrow()
    expect(() =>
      assertNoPayloadFilter({ AND: [{ OR: [{ payload: { path: ['a'] } }] }] })
    ).toThrow()
    expect(() => assertNoPayloadFilter({ NOT: { payload: {} } })).toThrow()
  })

  it('allows every other filter, including payload-free relations', () => {
    expect(() =>
      assertNoPayloadFilter({
        workspaceId: 'ws1',
        payloadPrunedAt: null,
        OR: [{ sessionId: 's1' }, { session: { parentSessionId: 's1' } }],
      })
    ).not.toThrow()
    expect(() => assertNoPayloadFilter(undefined)).not.toThrow()
    expect(() => assertNoPayloadFilter({ payload: undefined })).not.toThrow()
  })
})

describe('isEncryptionKeyConfigured', () => {
  const original = process.env.ENCRYPTION_KEY
  afterEach(() => {
    restoreEnv('ENCRYPTION_KEY', original)
  })

  it('needs a 64-character hex key', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    expect(isEncryptionKeyConfigured()).toBe(true)
    process.env.ENCRYPTION_KEY = 'z'.repeat(64)
    expect(isEncryptionKeyConfigured()).toBe(false)
    delete process.env.ENCRYPTION_KEY
    expect(isEncryptionKeyConfigured()).toBe(false)
  })
})

describe('unreadable payloads are never written', () => {
  const unreadable = { _lumo_unreadable: true }
  it.each([
    ['create', { data: { workspaceId: 'ws1', payload: unreadable } }],
    ['createMany', { data: [{ workspaceId: 'ws1', payload: unreadable }] }],
    [
      'updateMany',
      { where: { workspaceId: 'ws1' }, data: { payload: unreadable } },
    ],
    [
      'upsert',
      {
        where: { id: 'e1', workspaceId: 'ws1' },
        create: { workspaceId: 'ws1', payload: unreadable },
        update: {},
      },
    ],
  ])('%s refuses it with encryption on and off', async (operation, args) => {
    for (const enabled of [true, false]) {
      const { calls, query } = echoQuery()
      await expect(
        runHookEventOperation({ operation, args, query }, deps(enabled))
      ).rejects.toThrow(/unreadable/)
      expect(calls).toHaveLength(0)
    }
  })
})

describe('runHookEventOperation with encryption off', () => {
  it('clears the key id a sealed row still names when its payload is rewritten', async () => {
    const { calls, query } = echoQuery()
    await runHookEventOperation(
      {
        operation: 'updateMany',
        args: { where: { id: 'e1' }, data: { payload: { a: 1 } } },
        query,
      },
      deps(false)
    )
    expect(calls[0]!.data).toEqual({ payload: { a: 1 }, payloadKeyId: null })
  })
})
