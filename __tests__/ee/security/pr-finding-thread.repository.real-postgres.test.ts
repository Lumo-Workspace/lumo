/** @jest-environment node */
/**
 * LUM-1127 — `PrFindingThread` against a real Postgres replayed from every
 * migration (so the LUM-1127 migration itself is exercised): one row per
 * (PR, fingerprint), upsert re-points it, the read helpers the write-back,
 * webhook and task status use.
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
import { prFindingThreadRepository as repo } from '@/ee/security/repositories/pr-finding-thread.repository'

jest.setTimeout(180_000)

const base = {
  pullRequestId: 'pr',
  workspaceId: 'ws',
  ruleId: 'secret:aws',
  provenance: 'DETERMINISTIC' as const,
  kind: 'SECRET' as const,
  filePath: 'a.ts',
}

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'W', slug: 'w' })
  await harness.insert('pull_requests', {
    id: 'pr',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 7,
  })
  await harness.insert('pr_security_scans', {
    id: 'scan1',
    pullRequestId: 'pr',
    workspaceId: 'ws',
    headSha: 'h1',
    trigger: 'PR_EVENT',
    detectorVersion: 'x',
    judgeReviewScope: JSON.stringify(['a.ts']),
  })
  await harness.insert('pr_security_findings', {
    id: 'f1',
    scanId: 'scan1',
    kind: 'VULNERABILITY',
    ruleId: 'vuln:xss',
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath: 'b.ts',
    title: 't',
    detail: 'd',
    evidence: 'e',
    fingerprint: 'fp-meta',
  })
})
afterAll(async () => harness.stop())

test('upsert creates one row per (PR, fingerprint) and re-points it on a second post', async () => {
  await repo.upsert({ ...base, fingerprint: 'fp1', commentId: '1' })
  await repo.upsert({
    ...base,
    fingerprint: 'fp1',
    commentId: '2',
    threadNodeId: 'T2',
  })
  const rows = await repo.findByPullRequest('pr')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    fingerprint: 'fp1',
    commentId: '2',
    threadNodeId: 'T2',
    state: 'OPEN',
  })
})

test('update, findByThreadRef and findResolvedByUserFingerprints', async () => {
  const [row] = await repo.findByPullRequest('pr')
  await repo.update(row!.id, {
    state: 'RESOLVED_BY_USER',
    resolvedByLogin: 'alice',
    resolvedAt: new Date(),
  })
  expect(
    await repo.findByThreadRef('pr', { threadNodeId: 'T2', commentIds: [] })
  ).toHaveLength(1)
  expect(
    await repo.findByThreadRef('pr', { threadNodeId: null, commentIds: ['2'] })
  ).toHaveLength(1)
  expect(
    await repo.findByThreadRef('pr', { threadNodeId: null, commentIds: [] })
  ).toEqual([])
  const resolved = await repo.findResolvedByUserFingerprints(['pr', 'other'])
  expect([...(resolved.get('pr') ?? [])]).toEqual(['fp1'])
  expect(resolved.has('other')).toBe(false)
})

test('re-pointing a thread clears a stale addressedInSha', async () => {
  await repo.upsert({ ...base, fingerprint: 'fp2', commentId: '5' })
  const [r] = (await repo.findByPullRequest('pr')).filter(
    x => x.fingerprint === 'fp2'
  )
  await repo.update(r!.id, { state: 'ADDRESSED', addressedInSha: 'h1' })
  await repo.upsert({ ...base, fingerprint: 'fp2', commentId: '6' })
  const [after] = (await repo.findByPullRequest('pr')).filter(
    x => x.fingerprint === 'fp2'
  )
  expect(after).toMatchObject({
    commentId: '6',
    state: 'OPEN',
    addressedInSha: null,
  })
})

test('findLayerMetaByFingerprints reads the layer facts from the PR findings', async () => {
  await expect(
    repo.findLayerMetaByFingerprints('pr', ['fp-meta', 'nope'])
  ).resolves.toEqual([
    {
      fingerprint: 'fp-meta',
      ruleId: 'vuln:xss',
      provenance: 'LLM_JUDGE',
      kind: 'VULNERABILITY',
      filePath: 'b.ts',
    },
  ])
})

test('findIdentitiesByFingerprints reads line, title and evidence of the newest row', async () => {
  await harness.insert('pr_security_findings', {
    id: 'f-id-1',
    scanId: 'scan1',
    kind: 'CORRECTNESS',
    ruleId: 'review:doc_mismatch',
    severity: 'LOW',
    provenance: 'LLM_JUDGE',
    filePath: 'scripts/probe.ts',
    line: 3,
    title: 'console.log used in scripts',
    detail: 'd',
    evidence: "console.log('probe')",
    fingerprint: 'fp-id',
  })
  await expect(
    repo.findIdentitiesByFingerprints('pr', ['fp-id', 'nope'])
  ).resolves.toEqual([
    {
      fingerprint: 'fp-id',
      ruleId: 'review:doc_mismatch',
      provenance: 'LLM_JUDGE',
      filePath: 'scripts/probe.ts',
      line: 3,
      title: 'console.log used in scripts',
      evidence: "console.log('probe')",
    },
  ])
  await expect(repo.findIdentitiesByFingerprints('pr', [])).resolves.toEqual([])
})

test('the scan row keeps judgeReviewScope as JSON', async () => {
  const rows = await harness.query<{ judgeReviewScope: unknown }>(
    `select "judgeReviewScope" from pr_security_scans where id = 'scan1'`
  )
  expect(rows[0]!.judgeReviewScope).toEqual(['a.ts'])
})
