/**
 * @jest-environment node
 *
 * LUM-1150 follow-up #3 — stage A's persist tells whether the managed run
 * already landed, against a REAL Postgres replayed from every migration.
 * Production probe PR #59: the managed run wrote its layers and synced the
 * PR (15:45:03, "the scan is still running") before stage A persisted
 * (15:45:12); stage A, having queued the run, left the sync to it, and the
 * summary never got the AI review, the checks or the description summary.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import {
  managedLayerLanded,
  prSecurityScanRepository as repo,
} from '@/ee/security/repositories/pr-security-scan.repository'

jest.setTimeout(180_000)

const FINAL = {
  status: 'CLEAN' as const,
  judgeStatus: 'RAN' as const,
  truncated: false,
  stages: {
    secrets: 'RAN' as const,
    judge: 'RAN' as const,
    external: 'PENDING' as const,
    supplyChain: 'PENDING' as const,
  },
  partialCauses: [],
}

async function seedScan(id: string): Promise<void> {
  await harness.insert('pr_security_scans', {
    id,
    pullRequestId: 'pr59',
    workspaceId: 'ws',
    headSha: `${id}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 40),
    status: 'RUNNING',
    stages: JSON.stringify({}),
    trigger: 'PR_EVENT',
    detectorVersion: 'x',
  })
  // Stage A queued the managed run: both of its layers go PENDING.
  await repo.setManagedRunId(id, `run_${id}`)
}

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'W', slug: 'w' })
  await harness.insert('pull_requests', {
    id: 'pr59',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 59,
    state: 'open',
  })
})
afterAll(async () => harness.stop())

describe('persistResult reports the managed run landing first', () => {
  it('the managed run wrote its layers before stage A persisted → landed (stage A must sync)', async () => {
    await seedScan('s_landed')
    await repo.ingestExternalFindings('s_landed', ['semgrep'], [], {
      partialCauses: [],
    })
    await repo.ingestExternalFindings('s_landed', ['osv-scanner'], [], {
      partialCauses: [],
      stage: 'supplyChain',
    })
    const outcome = await repo.persistResult('s_landed', [], FINAL)
    expect(outcome).toEqual({ managedLayerLanded: true })
    // The run's layers survive stage A's PENDING.
    expect(await repo.findStagesById('s_landed')).toMatchObject({
      external: 'RAN',
      supplyChain: 'RAN',
    })
    expect(await repo.findStatusById('s_landed')).toBe('CLEAN')
  })

  it('the managed run still running when stage A persisted → not landed (its own sync comes after)', async () => {
    await seedScan('s_pending')
    expect(await repo.findStatusById('s_pending')).toBe('RUNNING')
    const outcome = await repo.persistResult('s_pending', [], FINAL)
    expect(outcome).toEqual({ managedLayerLanded: false })
  })
})

describe('managedLayerLanded', () => {
  it('only the states the managed side writes count', () => {
    expect(managedLayerLanded(null)).toBe(false)
    expect(managedLayerLanded({})).toBe(false)
    expect(
      managedLayerLanded({ external: 'PENDING', supplyChain: 'PENDING' })
    ).toBe(false)
    expect(managedLayerLanded({ external: 'NOT_CONFIGURED' })).toBe(false)
    expect(managedLayerLanded({ external: 'RAN' })).toBe(true)
    expect(managedLayerLanded({ external: 'FAILED' })).toBe(true)
    expect(managedLayerLanded({ external: 'SUPERSEDED' })).toBe(true)
    expect(
      managedLayerLanded({ external: 'PENDING', supplyChain: 'SKIPPED' })
    ).toBe(true)
  })
})

it('findStatusById is null for a row that is gone', async () => {
  expect(await repo.findStatusById('nope')).toBeNull()
})
