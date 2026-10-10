/** @jest-environment node */
import { createPgliteHarness } from '../scripts/test-support/pglite-harness'
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const migration = '20261026090000_lum1056_pr_review_convergence'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: migration,
})
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
import { prReviewControlRepository } from '@/lib/repositories/pr-review-control.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'

jest.setTimeout(180_000)
beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', {
    id: 'ws',
    name: 'Review tests',
    slug: 'review-tests',
  })
  await harness.insert('pull_requests', {
    id: 'pr',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 7,
  })
  await harness.applyMigration(migration)
})
afterAll(async () => harness.stop())

test('migration preserves an existing PR and initializes its review budget', async () => {
  expect(await prReviewControlRepository.get('pr')).toEqual({
    reviewPaused: false,
    reviewRoundLimit: 2,
    reviewHeads: [],
  })
  await expect(
    prReviewControlRepository.update('pr', 'resume', 0)
  ).rejects.toThrow()
})

test('real reservations, duplicate head retries, pause and resume enforce the persisted budget', async () => {
  const admitted = await Promise.all(
    ['a', 'b', 'c', 'd'].map(head =>
      prReviewControlRepository.reserve('pr', head)
    )
  )
  expect(admitted.filter(Boolean)).toHaveLength(2)
  expect((await prReviewControlRepository.get('pr')).reviewHeads).toHaveLength(
    2
  )
  expect(await prReviewControlRepository.reserve('pr', 'a')).toBe(true)
  await prReviewControlRepository.update('pr', 'pause')
  expect(await prReviewControlRepository.reserve('pr', 'a')).toBe(false)
  await prReviewControlRepository.update('pr', 'resume', 3)
  expect(await prReviewControlRepository.reserve('pr', 'c')).toBe(true)
  expect(await prReviewControlRepository.get('pr')).toEqual({
    reviewPaused: false,
    reviewRoundLimit: 3,
    reviewHeads: ['c'],
  })
})

test('same-head manual restarts have only one claimant and cannot collide with an async writer', async () => {
  await harness.insert('pr_security_scans', {
    id: 'scan',
    pullRequestId: 'pr',
    workspaceId: 'ws',
    headSha: 'c',
    status: 'CLEAN',
    trigger: 'PR_EVENT',
    stages: JSON.stringify({ judge: 'RAN' }),
  })
  await harness.insert('pr_security_findings', {
    id: 'ruled',
    scanId: 'scan',
    kind: 'VULNERABILITY',
    severity: 'HIGH',
    provenance: 'LLM_JUDGE',
    fingerprint: 'ruled-fp',
    ruleId: 'vuln:sql_injection',
    disposition: 'FALSE_POSITIVE',
    dispositionNote: 'human ruled',
  })
  const claims = await Promise.all([
    prSecurityScanRepository.restart('scan', true),
    prSecurityScanRepository.restart('scan', true),
  ])
  expect(claims.filter(Boolean)).toHaveLength(1)
  expect(claims.find(Array.isArray)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'ruled', disposition: 'FALSE_POSITIVE' }),
    ])
  )
  await prSecurityScanRepository.finalize('scan', {
    status: 'FAILED',
    judgeStatus: 'UNAVAILABLE',
    truncated: false,
    stages: { judge: 'FAILED' },
    partialCauses: [],
  })
  expect(
    await harness.prisma!.prSecurityFinding.findUnique({
      where: { id: 'ruled' },
    })
  ).toMatchObject({
    disposition: 'FALSE_POSITIVE',
    dispositionNote: 'human ruled',
  })
  await harness.prisma!.prSecurityScan.update({
    where: { id: 'scan' },
    data: { status: 'CLEAN', stages: { hunt: 'PENDING' } },
  })
  expect(await prSecurityScanRepository.restart('scan', true)).toBe(false)
})
