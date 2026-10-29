/**
 * @jest-environment node
 *
 * LUM-1259 retention (user ruling, option A): local scan runs follow the
 * workspace's session record setting — a RETAIN day tier deletes runs older
 * than the tier, USED_UP deletes them after 30 days, keep-forever keeps them;
 * a stricter setting only governs runs that arrived after the change (the
 * LUM-933 legacy segment); findings go with their run (FK cascade); the
 * plugin contributes the sweep the core prune cron runs.
 */
jest.mock('@/lib/repositories/hook-event-retention.repository', () => ({
  hookEventRetentionRepository: { listWorkspacesWithRetention: jest.fn() },
}))
jest.mock('@/lib/db/workspace-scope', () => ({
  scopedPrisma: { localScanRun: { deleteMany: jest.fn() } },
}))

import { readFileSync } from 'fs'
import { join } from 'path'
import { hookEventRetentionRepository } from '@/lib/repositories/hook-event-retention.repository'
import { scopedPrisma } from '@/lib/db/workspace-scope'
import {
  LOCAL_SCAN_USED_UP_DAYS,
  localScanLogRetentionService,
  localScanRetentionDays,
} from '@/ee/security/services/local-scan-log-retention.service'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const NOW = new Date('2026-10-20T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

const ws = (over: object = {}) => ({
  id: 'ws_1',
  hookEventRetentionMode: 'RETAIN' as const,
  hookEventRetentionDays: null as number | null,
  hookEventRetentionSince: null as Date | null,
  hookEventRetentionLegacyDays: null as number | null,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  m(scopedPrisma.localScanRun.deleteMany).mockResolvedValue({ count: 2 })
})

const deletes = () =>
  m(scopedPrisma.localScanRun.deleteMany).mock.calls.map(c => c[0].where)

describe('local scan log retention', () => {
  it('RETAIN with a day tier: deletes runs that arrived before the tier', async () => {
    m(
      hookEventRetentionRepository.listWorkspacesWithRetention
    ).mockResolvedValue([ws({ hookEventRetentionDays: 90 })])
    expect(await localScanLogRetentionService.sweep(NOW)).toEqual({
      localScanRuns: 2,
    })
    expect(deletes()).toEqual([
      { workspaceId: 'ws_1', createdAt: { lt: ago(90) } },
    ])
  })

  it(`USED_UP: deletes runs ${LOCAL_SCAN_USED_UP_DAYS} days after they arrived`, async () => {
    m(
      hookEventRetentionRepository.listWorkspacesWithRetention
    ).mockResolvedValue([ws({ hookEventRetentionMode: 'USED_UP' })])
    await localScanLogRetentionService.sweep(NOW)
    expect(LOCAL_SCAN_USED_UP_DAYS).toBe(30)
    expect(deletes()).toEqual([
      { workspaceId: 'ws_1', createdAt: { lt: ago(30) } },
    ])
  })

  it('keep forever (RETAIN, no tier): nothing is deleted', async () => {
    expect(localScanRetentionDays(ws())).toBeNull()
    // The repository never lists keep-forever workspaces; even if one came
    // through, the sweep deletes nothing for it.
    m(
      hookEventRetentionRepository.listWorkspacesWithRetention
    ).mockResolvedValue([ws()])
    expect(await localScanLogRetentionService.sweep(NOW)).toEqual({
      localScanRuns: 0,
    })
    expect(scopedPrisma.localScanRun.deleteMany).not.toHaveBeenCalled()
  })

  it('a stricter setting governs only runs that arrived after the change; older ones follow the legacy tier', async () => {
    const since = ago(10)
    m(
      hookEventRetentionRepository.listWorkspacesWithRetention
    ).mockResolvedValue([
      ws({
        hookEventRetentionDays: 30,
        hookEventRetentionSince: since,
        hookEventRetentionLegacyDays: 365,
      }),
    ])
    await localScanLogRetentionService.sweep(NOW)
    expect(deletes()).toEqual([
      { workspaceId: 'ws_1', createdAt: { lt: ago(30), gte: since } },
      { workspaceId: 'ws_1', createdAt: { lt: ago(365) } },
    ])
  })

  it('a legacy segment with no tier (kept forever before the change) is left alone', async () => {
    m(
      hookEventRetentionRepository.listWorkspacesWithRetention
    ).mockResolvedValue([
      ws({
        hookEventRetentionMode: 'USED_UP',
        hookEventRetentionSince: ago(5),
      }),
    ])
    await localScanLogRetentionService.sweep(NOW)
    expect(deletes()).toEqual([
      { workspaceId: 'ws_1', createdAt: { lt: ago(30), gte: ago(5) } },
    ])
  })

  it('findings go with their run, and workspace deletion cascades (schema)', () => {
    const schema = readFileSync(
      join(__dirname, '../../../prisma/schema.prisma'),
      'utf8'
    )
    expect(schema).toMatch(
      /run LocalScanRun @relation\(fields: \[runId\], references: \[id\], onDelete: Cascade\)/
    )
    expect(schema).toMatch(
      /workspace Workspace\s+@relation\(fields: \[workspaceId\], references: \[id\], onDelete: Cascade\)\n\s+findings  LocalScanFinding\[\]/
    )
  })
})

describe('the plugin sweep extension point', () => {
  it('the security plugin contributes the local scan log sweep to the core cron', async () => {
    m(
      hookEventRetentionRepository.listWorkspacesWithRetention
    ).mockResolvedValue([ws({ hookEventRetentionDays: 30 })])
    const { sweepPluginRetention } = await import('@/lib/plugins/retention')
    const { getPluginRegistry } = await import('@/lib/plugins/registry')
    expect(getPluginRegistry().retention.map(r => r.key)).toContain(
      'localScanLog'
    )
    expect(await sweepPluginRetention(NOW)).toEqual({ localScanRuns: 2 })
  })
})

describe('sweepPluginRetention', () => {
  it('sums every sweep by noun, runs them all, and rethrows the first failure', async () => {
    const { createPluginRegistry } = await import('@/lib/plugins/registry')
    const ran: string[] = []
    const registry = createPluginRegistry([
      {
        id: 'a',
        register: api =>
          api.retention({
            key: 'a',
            sweep: async () => {
              ran.push('a')
              throw new Error('a down')
            },
          }),
      },
      {
        id: 'b',
        register: api =>
          api.retention({
            key: 'b',
            sweep: async () => {
              ran.push('b')
              return { rows: 1 }
            },
          }),
      },
    ])
    jest.resetModules()
    jest.doMock('@/lib/plugins/registry', () => ({
      getPluginRegistry: () => registry,
    }))
    const { sweepPluginRetention } = await import('@/lib/plugins/retention')
    await expect(sweepPluginRetention(NOW)).rejects.toThrow('a down')
    expect(ran).toEqual(['a', 'b'])
    jest.dontMock('@/lib/plugins/registry')
  })
})
