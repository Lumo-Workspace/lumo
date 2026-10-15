/** @jest-environment node */
/**
 * LUM-1150 follow-up — the inline-comment claim against a real Postgres
 * replayed from every migration (so the claim column's migration is
 * exercised): two write-backs racing for the same rows win disjoint sets,
 * a released or stale claim can be won again.
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
import { prSecurityScanRepository as repo } from '@/ee/security/repositories/pr-security-scan.repository'

jest.setTimeout(180_000)

const finding = (id: string) => ({
  id,
  scanId: 'scan1',
  kind: 'CORRECTNESS',
  ruleId: 'review:logic_error',
  severity: 'HIGH',
  provenance: 'LLM_JUDGE',
  filePath: 'a.ts',
  title: 't',
  detail: 'd',
  evidence: 'e',
  fingerprint: `fp-${id}`,
})

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'W', slug: 'w' })
  await harness.insert('pull_requests', {
    id: 'pr',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 41,
  })
  await harness.insert('pr_security_scans', {
    id: 'scan1',
    pullRequestId: 'pr',
    workspaceId: 'ws',
    headSha: 'b363c45',
    trigger: 'PR_EVENT',
    detectorVersion: 'x',
  })
  for (const id of ['f1', 'f2', 'f3']) {
    await harness.insert('pr_security_findings', finding(id))
  }
})
afterAll(async () => harness.stop())

const longAgo = () => new Date(Date.now() - 5 * 60_000)

test('two concurrent claims on the same rows win disjoint sets that cover them', async () => {
  const [a, b] = await Promise.all([
    repo.claimInlineComments(['f1', 'f2'], longAgo()),
    repo.claimInlineComments(['f1', 'f2'], longAgo()),
  ])
  expect([...a].filter(id => b.has(id))).toEqual([])
  expect([...a, ...b].sort()).toEqual(['f1', 'f2'])
})

test('a held claim is not won again; a released one is', async () => {
  expect(await repo.claimInlineComments(['f1'], longAgo())).toEqual(new Set())
  await repo.releaseInlineCommentClaims(['f1'])
  expect(await repo.claimInlineComments(['f1'], longAgo())).toEqual(
    new Set(['f1'])
  )
})

test('a claim older than staleBefore is taken over', async () => {
  await repo.claimInlineComments(['f3'], longAgo())
  // Everything claimed before "a minute from now" counts as stale.
  const future = new Date(Date.now() + 60_000)
  expect(await repo.claimInlineComments(['f3'], future)).toEqual(
    new Set(['f3'])
  )
})
