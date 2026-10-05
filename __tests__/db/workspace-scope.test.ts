/**
 * @jest-environment node
 *
 * LUM-979 — the workspace-scope query extension, unit level: the pure
 * "is this query tenant-scoped?" check, the throw/log policy, the escape
 * hatch, and the extension callback wired onto a client. The same mechanism
 * against a real Postgres lives in workspace-scope.real-postgres.test.ts.
 */
import { readFileSync } from 'fs'
import path from 'path'

const holder: { client: unknown } = { client: null }
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.client
  },
}))

import {
  WORKSPACE_SCOPED_MODELS,
  findScopeViolation,
  enforceWorkspaceScope,
  scopeMode,
  unscoped,
  withWorkspaceScope,
  scopedPrisma,
} from '@/lib/db/workspace-scope'
import { logger } from '@/lib/logger'

describe('findScopeViolation — reads, updates, deletes', () => {
  const READ_OPS = [
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'findUnique',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'delete',
    'deleteMany',
  ]

  it.each(READ_OPS)('%s without a where is a violation', op => {
    expect(findScopeViolation('Project', op, {})).toMatch(/Project\./)
    expect(findScopeViolation('Project', op, undefined)).toMatch(/Project\./)
  })

  it.each(READ_OPS)('%s with only an id is a violation', op => {
    expect(
      findScopeViolation('Project', op, { where: { id: 'p1' } })
    ).not.toBeNull()
  })

  it.each(READ_OPS)('%s with a concrete workspaceId passes', op => {
    expect(
      findScopeViolation('Project', op, {
        where: { id: 'p1', workspaceId: 'w' },
      })
    ).toBeNull()
  })

  it('accepts equals / non-empty in / AND / workspaceId_* compound keys', () => {
    const ok = [
      { workspaceId: { equals: 'w' } },
      { workspaceId: { in: ['w1', 'w2'] } },
      { AND: [{ status: 'x' }, { workspaceId: 'w' }] },
      { AND: { workspaceId: 'w' } },
      { workspaceId_number: { workspaceId: 'w', number: 3 } },
      { workspaceId_clerkId: { workspaceId: 'w', clerkId: 'c' } },
    ]
    for (const where of ok) {
      expect(findScopeViolation('Document', 'findFirst', { where })).toBeNull()
    }
  })

  it('rejects conditions that do not pin a workspace', () => {
    const bad = [
      // Prisma drops `undefined` filters — this matches every workspace.
      { workspaceId: undefined },
      { workspaceId: '' },
      { workspaceId: null },
      { workspaceId: { in: [] } },
      { workspaceId: { not: 'w' } },
      { workspaceId: { equals: undefined } },
      // OR / NOT can widen the match past the workspace.
      { OR: [{ workspaceId: 'w' }, { id: 'x' }] },
      { NOT: { workspaceId: 'w' } },
      // A relation filter is not this model's own column.
      { workspace: { slug: 'acme' } },
      { workspaceId_number: { workspaceId: undefined, number: 3 } },
    ]
    for (const where of bad) {
      expect(
        findScopeViolation('Document', 'findFirst', { where })
      ).not.toBeNull()
    }
  })
})

describe('findScopeViolation — creates and upserts', () => {
  it('create needs workspaceId (or a workspace connect) in data', () => {
    expect(
      findScopeViolation('Project', 'create', { data: { name: 'x' } })
    ).not.toBeNull()
    expect(
      findScopeViolation('Project', 'create', {
        data: { name: 'x', workspaceId: 'w' },
      })
    ).toBeNull()
    expect(
      findScopeViolation('Project', 'create', {
        data: { name: 'x', workspace: { connect: { id: 'w' } } },
      })
    ).toBeNull()
  })

  it('createMany needs workspaceId on every row', () => {
    expect(
      findScopeViolation('View', 'createMany', {
        data: [{ workspaceId: 'w' }, { name: 'no ws' }],
      })
    ).not.toBeNull()
    expect(
      findScopeViolation('View', 'createManyAndReturn', {
        data: [{ workspaceId: 'w' }, { workspaceId: 'w' }],
      })
    ).toBeNull()
    expect(
      findScopeViolation('View', 'createMany', { data: [] })
    ).not.toBeNull()
  })

  it('upsert needs both a scoped where and a scoped create', () => {
    const scoped = { id: 'v', workspaceId: 'w' }
    expect(
      findScopeViolation('View', 'upsert', {
        where: scoped,
        create: { workspaceId: 'w' },
        update: {},
      })
    ).toBeNull()
    expect(
      findScopeViolation('View', 'upsert', {
        where: { id: 'v' },
        create: { workspaceId: 'w' },
        update: {},
      })
    ).not.toBeNull()
    expect(
      findScopeViolation('View', 'upsert', {
        where: scoped,
        create: {},
        update: {},
      })
    ).not.toBeNull()
  })

  it('an unknown operation fails closed', () => {
    expect(findScopeViolation('Project', 'somethingNew', {})).not.toBeNull()
  })

  it('models without a direct workspaceId column are not checked', () => {
    expect(
      findScopeViolation('Task', 'findUnique', { where: { id: 't' } })
    ).toBeNull()
    expect(findScopeViolation('Workspace', 'findMany', {})).toBeNull()
  })
})

describe('WORKSPACE_SCOPED_MODELS', () => {
  it('is exactly the schema models with a direct `workspaceId String` column', () => {
    const schema = readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'),
      'utf8'
    )
    const fromSchema = new Set<string>()
    let model: string | null = null
    for (const line of schema.split('\n')) {
      const m = /^model\s+(\w+)\s*\{/.exec(line)
      if (m) model = m[1]!
      else if (/^\}/.test(line)) model = null
      else if (model && /^\s+workspaceId\s+String(\s|$)/.test(line))
        fromSchema.add(model)
    }
    expect([...WORKSPACE_SCOPED_MODELS].sort()).toEqual([...fromSchema].sort())
  })
})

describe('scopeMode / enforceWorkspaceScope', () => {
  const env = process.env as Record<string, string | undefined>
  const saved = {
    NODE_ENV: env.NODE_ENV,
    LUMO_WORKSPACE_SCOPE: env.LUMO_WORKSPACE_SCOPE,
  }
  // Assigning `undefined` to process.env stores the string "undefined", so
  // restore by deleting keys that were unset.
  const restore = (key: keyof typeof saved) => {
    if (saved[key] === undefined) delete env[key]
    else env[key] = saved[key]
  }
  afterEach(() => {
    restore('NODE_ENV')
    restore('LUMO_WORKSPACE_SCOPE')
    jest.restoreAllMocks()
  })

  it('throws in test env', () => {
    delete env.LUMO_WORKSPACE_SCOPE
    expect(scopeMode()).toBe('throw')
    let caught: unknown
    try {
      enforceWorkspaceScope('Project', 'findUnique', { where: { id: 'p' } })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).toMatchObject({
      status: 500,
      code: 'WORKSPACE_SCOPE_MISSING',
    })
    expect((caught as Error).message).toMatch(/unscoped\('<reason>'\)/)
  })

  it('a scoped query passes silently', () => {
    expect(() =>
      enforceWorkspaceScope('Project', 'findUnique', {
        where: { id: 'p', workspaceId: 'w' },
      })
    ).not.toThrow()
  })

  it('logs (does not throw) in production, without argument values', () => {
    delete env.LUMO_WORKSPACE_SCOPE
    env.NODE_ENV = 'production'
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => {})
    expect(scopeMode()).toBe('log')
    expect(() =>
      enforceWorkspaceScope('Project', 'findUnique', {
        where: { id: 'secret-id-value' },
      })
    ).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(spy.mock.calls)).toContain('Project.findUnique')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-id-value')
  })

  it('LUMO_WORKSPACE_SCOPE overrides the environment default', () => {
    env.NODE_ENV = 'production'
    env.LUMO_WORKSPACE_SCOPE = 'throw'
    expect(scopeMode()).toBe('throw')
    env.NODE_ENV = 'test'
    env.LUMO_WORKSPACE_SCOPE = 'log'
    expect(scopeMode()).toBe('log')
  })
})

describe('withWorkspaceScope — extension callback', () => {
  type Hook = (p: {
    model: string
    operation: string
    args: unknown
    query: (a: unknown) => Promise<unknown>
  }) => Promise<unknown>

  function fakeClient() {
    let hook: Hook | null = null
    const client = {
      $extends: jest.fn(
        (ext: { query: { $allModels: { $allOperations: Hook } } }) => {
          hook = ext.query.$allModels.$allOperations
          return { extended: true }
        }
      ),
    }
    return { client, hook: () => hook! }
  }

  it('rejects an unscoped directly-scoped query before it reaches the database', async () => {
    const { client, hook } = fakeClient()
    withWorkspaceScope(client as never)
    const query = jest.fn(async () => 'row')
    await expect(
      (async () =>
        hook()({ model: 'Document', operation: 'findMany', args: {}, query }))()
    ).rejects.toMatchObject({ code: 'WORKSPACE_SCOPE_MISSING' })
    expect(query).not.toHaveBeenCalled()
  })

  it('passes scoped queries and unchecked models through unchanged', async () => {
    const { client, hook } = fakeClient()
    withWorkspaceScope(client as never)
    const query = jest.fn(async (a: unknown) => a)
    const args = { where: { workspaceId: 'w' } }
    await expect(
      hook()({ model: 'Document', operation: 'findMany', args, query })
    ).resolves.toBe(args)
    const taskArgs = { where: { id: 't' } }
    await expect(
      hook()({ model: 'Task', operation: 'findUnique', args: taskArgs, query })
    ).resolves.toBe(taskArgs)
  })
})

describe('scopedPrisma / unscoped', () => {
  afterEach(() => jest.restoreAllMocks())

  it('derives the checked client from the current base client, once per base', () => {
    const extended = { project: { findMany: jest.fn() } }
    const base = { $extends: jest.fn(() => extended) }
    holder.client = base
    expect(scopedPrisma.project).toBe(extended.project)
    expect(scopedPrisma.project).toBe(extended.project)
    expect(base.$extends).toHaveBeenCalledTimes(1)
  })

  it('passes a test double without $extends straight through', () => {
    const double = { project: { findMany: jest.fn() } }
    holder.client = double
    expect(scopedPrisma.project).toBe(double.project)
  })

  it('unscoped(reason) returns the unchecked base client and logs the reason', () => {
    const base = { $extends: jest.fn(() => ({})) }
    holder.client = base
    const spy = jest.spyOn(logger, 'debug').mockImplementation(() => {})
    expect(unscoped('cron: nightly retention sweep')).toBe(base)
    expect(spy).toHaveBeenCalledWith(
      '[workspace-scope] unscoped:',
      'cron: nightly retention sweep'
    )
  })

  it('unscoped() refuses an empty reason', () => {
    expect(() => unscoped('  ')).toThrow(/reason/)
  })
})
