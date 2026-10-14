/** @jest-environment node */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'
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
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

/** A single-commit push: the PR's commit count at that head. */
const push = (n: number, workspaceLimit = 2) => ({
  commitsAtHead: n,
  workspaceLimit,
})

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
  // LUM-1137: a PR whose owner chose a limit under LUM-1056 keeps it. The
  // row is written with raw SQL while the schema is at LUM-1056, so it still
  // exercises the LUM-1137 copy even though LUM-1138 later drops the column.
  await harness.applyMigration(migration)
  await harness.insert('pull_requests', {
    id: 'custom',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 8,
    reviewRoundLimit: 7,
  })
  // LUM-1127: and every later migration — the repositories under test
  // read today's columns (e.g. pr_security_scans.judgeReviewScope).
  const later = readdirSync(
    path.resolve(__dirname, '../../../prisma/migrations')
  )
    .filter(m => m > migration && /^\d{14}_/.test(m))
    .sort()
  await harness.applyMigrationsFrom(later[0]!)
})
afterAll(async () => harness.stop())

test('migration preserves an existing PR and initializes its review budget', async () => {
  expect(await prReviewControlRepository.get('pr')).toEqual({
    reviewPaused: false,
    reviewHeads: [],
    reviewHeadCommits: [],
    reviewCommitLimit: null,
  })
  // LUM-1137: an explicit LUM-1056 limit is kept as the PR's own limit; the
  // old default (2) adopts the workspace setting (null).
  expect(
    (await prReviewControlRepository.get('custom')).reviewCommitLimit
  ).toBe(7)
  await expect(
    prReviewControlRepository.update('pr', 'resume', 0)
  ).rejects.toThrow()
  // LUM-1138: the contract migration drops the LUM-1056 column.
  expect(
    await harness.query(
      `select 1 from information_schema.columns
        where table_name = 'pull_requests' and column_name = 'reviewRoundLimit'`
    )
  ).toEqual([])
})

test('real reservations, duplicate head retries, pause and resume enforce the persisted budget', async () => {
  const admitted = await Promise.all(
    ['a', 'b', 'c', 'd'].map((head, i) =>
      prReviewControlRepository.reserve('pr', head, push(i + 1))
    )
  )
  expect(admitted.filter(Boolean)).toHaveLength(2)
  expect((await prReviewControlRepository.get('pr')).reviewHeads).toHaveLength(
    2
  )
  expect(await prReviewControlRepository.reserve('pr', 'a', push(1))).toBe(true)
  await prReviewControlRepository.update('pr', 'pause')
  expect(await prReviewControlRepository.reserve('pr', 'a', push(1))).toBe(
    false
  )
  await prReviewControlRepository.update('pr', 'resume', 3)
  expect(await prReviewControlRepository.reserve('pr', 'c', push(3))).toBe(true)
  expect(await prReviewControlRepository.get('pr')).toEqual({
    reviewPaused: false,
    reviewHeads: ['c'],
    reviewHeadCommits: [3],
    reviewCommitLimit: 3,
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

test('releasing a superseded head returns its round to the budget', async () => {
  await prReviewControlRepository.update('pr', 'resume', 2)
  expect(await prReviewControlRepository.reserve('pr', 'x', push(1))).toBe(true)
  expect(await prReviewControlRepository.reserve('pr', 'y', push(2))).toBe(true)
  expect(await prReviewControlRepository.reserve('pr', 'z', push(3))).toBe(
    false
  )
  await prReviewControlRepository.release('pr', 'x')
  await prReviewControlRepository.release('pr', 'absent')
  expect(await prReviewControlRepository.get('pr')).toMatchObject({
    reviewHeads: ['y'],
    reviewHeadCommits: [2],
  })
  // y now counts both commits (x's and its own): z is still over the limit
  // of 2 — a superseded head's commits are reviewed by the next head.
  expect(await prReviewControlRepository.reserve('pr', 'z', push(3))).toBe(
    false
  )
  // Releasing the only reviewed head returns its commits to the budget.
  await prReviewControlRepository.release('pr', 'y')
  expect(await prReviewControlRepository.get('pr')).toMatchObject({
    reviewHeads: [],
    reviewHeadCommits: [],
  })
  expect(await prReviewControlRepository.reserve('pr', 'z', push(1))).toBe(true)
})

test('LUM-1137: with the default workspace setting, the 3rd (and 5th) single-commit push is reviewed and the 6th pauses', async () => {
  await harness.insert('pull_requests', {
    id: 'fresh',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 9,
  })
  const workspaceLimit =
    await securityColumnsRepository.findReviewAutoPauseAfter('ws')
  expect(workspaceLimit).toBe(5)
  const admitted: boolean[] = []
  for (let i = 1; i <= 6; i++)
    admitted.push(
      await prReviewControlRepository.reserve('fresh', `p${i}`, {
        commitsAtHead: i,
        workspaceLimit,
      })
    )
  expect(admitted).toEqual([true, true, true, true, true, false])
})

test('LUM-1137: the workspace pause-after is constrained to 0-100; 0 never pauses', async () => {
  await expect(
    harness.query(
      `update workspaces set "securityReviewAutoPauseAfter" = 101 where id = 'ws'`
    )
  ).rejects.toThrow()
  await harness.query(
    `update workspaces set "securityReviewAutoPauseAfter" = 0 where id = 'ws'`
  )
  const workspaceLimit =
    await securityColumnsRepository.findReviewAutoPauseAfter('ws')
  expect(workspaceLimit).toBe(0)
  await harness.insert('pull_requests', {
    id: 'never',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 10,
  })
  for (let i = 1; i <= 12; i++)
    expect(
      await prReviewControlRepository.reserve('never', `n${i}`, {
        commitsAtHead: i,
        workspaceLimit,
      })
    ).toBe(true)
})
