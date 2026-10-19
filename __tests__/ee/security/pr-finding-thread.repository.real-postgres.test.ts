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
      severity: 'LOW',
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

test('LUM-1127 follow-up #2: the thread row keeps its finding identity (hashes) across re-points and updates', async () => {
  await repo.upsert({ ...base, fingerprint: 'fp-legacy', commentId: '700' })
  const identity = {
    identityRuleId: 'review:data_integrity',
    identityLine: 30,
    identitySeverity: 'MEDIUM' as const,
    identityEvidenceHash: '0123456789abcdef0123456789abcdef',
    identityTitleTokens: ['aaa111', 'bbb222'],
  }
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-ident',
    commentId: '701',
    ...identity,
  })
  const byFp = async (fp: string) =>
    (await repo.findByPullRequest('pr')).find(r => r.fingerprint === fp)!
  // A row recorded without an identity reads as "not recorded".
  expect(await byFp('fp-legacy')).toEqual(
    expect.objectContaining({
      identityRuleId: null,
      identityLine: null,
      identitySeverity: null,
      identityEvidenceHash: null,
      identityTitleTokens: [],
    })
  )
  expect(await byFp('fp-ident')).toEqual(expect.objectContaining(identity))

  // Re-pointed without an identity: the recorded one stays.
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-ident',
    commentId: '702',
  })
  expect(await byFp('fp-ident')).toEqual(
    expect.objectContaining({ commentId: '702', ...identity })
  )

  // Carried to a relabelled finding: the identity moves on.
  const row = await byFp('fp-ident')
  await repo.update(row.id, {
    identityRuleId: 'review:logic_error',
    identityLine: 31,
    identityTitleTokens: ['ccc333'],
  })
  expect(await byFp('fp-ident')).toEqual(
    expect.objectContaining({
      identityRuleId: 'review:logic_error',
      identityLine: 31,
      identitySeverity: 'MEDIUM',
      identityTitleTokens: ['ccc333'],
    })
  )
})

test('LUM-1127 follow-up #3: a carry is kept on the row (aliases), a resolved thread covers its aliases, and a merged duplicate row is deleted', async () => {
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-orig',
    commentId: '800',
  })
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-dup',
    commentId: '801',
  })
  const byFp = async (fp: string) =>
    (await repo.findByPullRequest('pr')).find(r => r.fingerprint === fp)
  const orig = (await byFp('fp-orig'))!
  // A row recorded before the column existed reads as "no aliases".
  expect(orig.aliasFingerprints).toEqual([])
  await repo.update(orig.id, {
    aliasFingerprints: ['fp-relabelled', 'fp-dup'],
    state: 'RESOLVED_BY_USER',
    resolvedByLogin: 'alice',
  })
  expect((await byFp('fp-orig'))!.aliasFingerprints).toEqual([
    'fp-relabelled',
    'fp-dup',
  ])
  const resolved = await repo.findResolvedByUserFingerprints(['pr'])
  expect(
    ['fp-orig', 'fp-relabelled', 'fp-dup'].every(fp =>
      resolved.get('pr')!.has(fp)
    )
  ).toBe(true)

  await repo.delete((await byFp('fp-dup'))!.id)
  expect(await byFp('fp-dup')).toBeUndefined()
  // Deleting a row that is already gone is a no-op.
  await expect(repo.delete('missing')).resolves.toBeUndefined()
})

test('LUM-1127 follow-up #4: the thread row keeps the union of identities it carried (JSON), across re-points and updates', async () => {
  const v1 = {
    ruleId: 'review:logic_error',
    line: 31,
    evidenceHash: 'k1.e1',
    titleTokens: ['k1.a', 'k1.b'],
  }
  const v2 = {
    ruleId: 'review:api_misuse',
    line: 31,
    evidenceHash: null,
    titleTokens: ['k1.c'],
    crowded: true,
  }
  await repo.upsert({
    ...base,
    fingerprint: 'fp-hist-legacy',
    commentId: '900',
  })
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-hist',
    commentId: '901',
    identityRuleId: 'review:logic_error',
    identityTitleTokens: ['k1.a', 'k1.b'],
    identityHistory: [v1],
  })
  const byFp = async (fp: string) =>
    (await repo.findByPullRequest('pr')).find(r => r.fingerprint === fp)!
  // A row written before the column existed reads as "no history".
  expect((await byFp('fp-hist-legacy')).identityHistory).toEqual([])
  expect((await byFp('fp-hist')).identityHistory).toEqual([v1])

  const row = await byFp('fp-hist')
  await repo.update(row.id, { identityHistory: [v1, v2] })
  expect((await byFp('fp-hist')).identityHistory).toEqual([v1, v2])
  // An update that does not name it keeps it.
  await repo.update(row.id, { state: 'ADDRESSED' })
  expect((await byFp('fp-hist')).identityHistory).toEqual([v1, v2])
  // Re-pointed without an identity: kept; with one: replaced as given.
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-hist',
    commentId: '902',
  })
  expect((await byFp('fp-hist')).identityHistory).toEqual([v1, v2])
  await repo.upsert({
    ...base,
    provenance: 'LLM_JUDGE',
    kind: 'CORRECTNESS',
    fingerprint: 'fp-hist',
    commentId: '903',
    identityRuleId: 'review:api_misuse',
    identityHistory: [v2],
  })
  expect((await byFp('fp-hist')).identityHistory).toEqual([v2])
  // Malformed entries (hand edit) are skipped on read.
  await harness.query(
    `update pr_finding_threads set "identityHistory" = '[{"ruleId":1},{"ruleId":"r","line":null,"evidenceHash":null,"titleTokens":["t"]}]'::jsonb where fingerprint = 'fp-hist'`
  )
  expect((await byFp('fp-hist')).identityHistory).toEqual([
    { ruleId: 'r', line: null, evidenceHash: null, titleTokens: ['t'] },
  ])
})
