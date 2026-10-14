/** @jest-environment node */
/**
 * LUM-1131 — `PrReviewLearning` against a real Postgres replayed from every
 * migration (the LUM-1131 migration itself is exercised): a learning counts
 * only while its memory is ACTIVE, deleting the memory deletes the learning,
 * reads never cross workspaces, a reply makes at most one learning, and a
 * thread answers each reply once.
 */
// The poison gate's policy read fans out concurrently, which the single-
// connection PGlite harness cannot serve; the gate has its own tests.
jest.mock('@/lib/services/memory/write-gate', () => ({
  loadMemoryWriteGate: async () => ({
    screen: () => ({ ok: true, signals: null }),
  }),
}))
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: async () => {
    throw new Error('no gateway in tests')
  },
}))
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
  prReviewLearningRepository as repo,
  type NewReviewLearning,
} from '@/ee/security/repositories/pr-review-learning.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import {
  loadReviewLearnings,
  promoteLearningsOnMerge,
} from '@/ee/security/services/review-learnings.service'
import { memoryManagementService } from '@/lib/services/memory-management.service'

jest.setTimeout(180_000)

const content = (rule: string) =>
  JSON.stringify({ summary: 'PR review learning', rule, scope: 'o/r' })

const learning = (
  over: Partial<NewReviewLearning> &
    Pick<NewReviewLearning, 'memoryId' | 'sourceReplyId'>
): NewReviewLearning => ({
  workspaceId: 'ws',
  repo: 'o/r',
  pathGlob: null,
  ruleId: 'vuln:sql_injection',
  fingerprint: 'fp',
  sourcePullRequestId: 'pr',
  authorLogin: 'alice',
  ...over,
})

beforeAll(async () => {
  await harness.start()
  for (const [ws, project] of [
    ['ws', 'p1'],
    ['ws2', 'p2'],
  ] as const) {
    await harness.insert('workspaces', { id: ws, name: ws, slug: ws })
    await harness.insert('workspace_members', {
      id: `m-${ws}`,
      workspaceId: ws,
      clerkId: `c-${ws}`,
    })
    await harness.insert('teams', {
      id: `t-${ws}`,
      workspaceId: ws,
      name: 'T',
      identifier: ws === 'ws' ? 'LUM' : 'OTH',
    })
    await harness.insert('projects', {
      id: project,
      workspaceId: ws,
      teamId: `t-${ws}`,
      createdByMemberId: `m-${ws}`,
      name: project,
    })
  }
  await harness.insert('project_repositories', {
    id: 'r1',
    projectId: 'p1',
    fullName: 'O/R',
    name: 'R',
  })
  for (const [id, ws, project, status, rule] of [
    [
      'm-active',
      'ws',
      'p1',
      'ACTIVE',
      'Raw SQL in scripts/admin is intentional.',
    ],
    ['m-retired', 'ws', 'p1', 'INVALIDATED', 'Retired learning text here.'],
    [
      'm-docs',
      'ws',
      'p1',
      'ACTIVE',
      'Docs examples use fake tokens on purpose.',
    ],
    ['m-other-ws', 'ws2', 'p2', 'ACTIVE', 'Another tenant learning text.'],
    ['m-delete', 'ws', 'p1', 'ACTIVE', 'A learning that will be deleted.'],
  ] as const)
    await harness.insert('memories', {
      id,
      workspaceId: ws,
      projectId: project,
      scope: 'PROJECT',
      category: 'CONVENTION',
      content: content(rule),
      status,
    })
  await harness.insert('pull_requests', {
    id: 'pr',
    workspaceId: 'ws',
    repo: 'o/r',
    number: 7,
  })

  await repo.create(
    learning({
      memoryId: 'm-active',
      pathGlob: 'scripts/**',
      sourceReplyId: '1',
    })
  )
  await repo.create(learning({ memoryId: 'm-retired', sourceReplyId: '2' }))
  await repo.create(
    learning({ memoryId: 'm-docs', pathGlob: 'docs/**', sourceReplyId: '3' })
  )
  await repo.create(
    learning({ workspaceId: 'ws2', memoryId: 'm-other-ws', sourceReplyId: '1' })
  )
  await repo.create(learning({ memoryId: 'm-delete', sourceReplyId: '5' }))
})
afterAll(async () => harness.stop())

test('only ACTIVE memories of this workspace and repository count (repo name case-insensitive)', async () => {
  const rows = await repo.findActiveForRepo('ws', 'O/r', 10)
  const rules = rows.map(r => (r.content as { rule: string }).rule).sort()
  expect(rules).toEqual([
    'A learning that will be deleted.',
    'Docs examples use fake tokens on purpose.',
    'Raw SQL in scripts/admin is intentional.',
  ])
  expect(await repo.findActiveForRepo('ws', 'o/other', 10)).toEqual([])
  const other = await repo.findActiveForRepo('ws2', 'o/r', 10)
  expect(other.map(r => (r.content as { rule: string }).rule)).toEqual([
    'Another tenant learning text.',
  ])
})

test('an edit in the memory is what the review reads; only relevant globs are kept', async () => {
  await harness.prisma!.memory.update({
    where: { id: 'm-active' },
    data: {
      content: {
        summary: 's',
        rule: 'Raw SQL in scripts/admin is intentional (edited).',
        scope: 'o/r',
      },
    },
  })
  const block = await loadReviewLearnings({
    workspaceId: 'ws',
    repo: 'o/r',
    pullRequestId: 'pr',
    reviewedPaths: ['scripts/admin/run.ts'],
  })
  expect(block).toContain(
    '[scripts/**] Raw SQL in scripts/admin is intentional (edited).'
  )
  expect(block).not.toContain('Docs examples')
  expect(block).not.toContain('Retired')
  expect(block).not.toContain('Another tenant')
})

test('deleting the memory deletes the learning', async () => {
  await harness.prisma!.memory.delete({ where: { id: 'm-delete' } })
  expect(await repo.findBySourceReply('ws', '5')).toBeNull()
  const rows = await harness.query<{ n: number }>(
    `select count(*)::int as n from pr_review_learnings where "memoryId" = 'm-delete'`
  )
  expect(rows[0]!.n).toBe(0)
})

test('one learning per reply per workspace; the same reply id in another workspace is its own', async () => {
  await expect(repo.findBySourceReply('ws', '1')).resolves.toMatchObject({
    memoryId: 'm-active',
  })
  await expect(
    repo.create(learning({ memoryId: 'm-docs', sourceReplyId: '1' }))
  ).rejects.toThrow()
})

test('findProjectIdByRepoFullName pins the workspace', async () => {
  await expect(
    projectRepository.findProjectIdByRepoFullName('ws', 'o/r')
  ).resolves.toBe('p1')
  await expect(
    projectRepository.findProjectIdByRepoFullName('ws2', 'o/r')
  ).resolves.toBeNull()
})

test('claimReply answers each reply once', async () => {
  await prFindingThreadRepository.upsert({
    pullRequestId: 'pr',
    workspaceId: 'ws',
    fingerprint: 'fp',
    commentId: '100',
    ruleId: 'vuln:sql_injection',
    provenance: 'LLM_JUDGE',
    kind: 'VULNERABILITY',
    filePath: 'scripts/admin/run.ts',
  })
  const [row] = await prFindingThreadRepository.findByPullRequest('pr')
  await expect(
    prFindingThreadRepository.claimReply(row!.id, '555')
  ).resolves.toBe(true)
  await expect(
    prFindingThreadRepository.claimReply(row!.id, '555')
  ).resolves.toBe(false)
  await expect(
    prFindingThreadRepository.claimReply(row!.id, '556')
  ).resolves.toBe(true)
})

const NEW_CONTENT = {
  summary: 'PR review learning: atomic',
  rule: 'Atomic learning text for the transaction test.',
  scope: 'Lumo AI review of o/r',
}
const countMemories = async (rule: string) =>
  (await harness.prisma!.memory.findMany({ select: { content: true } })).filter(
    m => (m.content as { rule?: string }).rule === rule
  ).length

test('memory and learning scope land in one transaction: a failing scope write leaves no orphan memory', async () => {
  await expect(
    memoryManagementService.createReviewLearning(
      {
        projectId: 'p1',
        workspaceId: 'ws',
        content: NEW_CONTENT,
        actorMemberId: null,
      },
      async (memoryId, tx) => {
        // The scope row is written, then the write fails: both roll back.
        // (A thrown error, not a constraint violation: the single-connection
        // PGlite harness cannot recover from a server-side aborted tx.)
        await repo.create(learning({ memoryId, sourceReplyId: 'atomic-0' }), tx)
        throw new Error('scope write failed')
      }
    )
  ).rejects.toThrow('scope write failed')
  expect(await countMemories(NEW_CONTENT.rule)).toBe(0)
  await expect(repo.findBySourceReply('ws', 'atomic-0')).resolves.toBeNull()

  const { id } = await memoryManagementService.createReviewLearning(
    {
      projectId: 'p1',
      workspaceId: 'ws',
      content: NEW_CONTENT,
      actorMemberId: null,
    },
    async (memoryId, tx) => {
      await repo.create(learning({ memoryId, sourceReplyId: 'atomic-1' }), tx)
    }
  )
  expect(await countMemories(NEW_CONTENT.rule)).toBe(1)
  await expect(repo.findBySourceReply('ws', 'atomic-1')).resolves.toMatchObject(
    {
      memoryId: id,
      content: NEW_CONTENT,
    }
  )
})

test('releaseReply gives a failed reply back, only while it holds the claim', async () => {
  const [row] = await prFindingThreadRepository.findByPullRequest('pr')
  await prFindingThreadRepository.claimReply(row!.id, '700')
  await prFindingThreadRepository.releaseReply(row!.id, '700')
  await expect(
    prFindingThreadRepository.claimReply(row!.id, '700')
  ).resolves.toBe(true)
  // A newer reply's claim is not released by an older reply's failure.
  await prFindingThreadRepository.claimReply(row!.id, '701')
  await prFindingThreadRepository.releaseReply(row!.id, '700')
  await expect(
    prFindingThreadRepository.claimReply(row!.id, '701')
  ).resolves.toBe(false)
})

describe('LUM-1131 scope: CodeRabbit learnings rules', () => {
  const RULE = 'Scope rule learning from PR 20.'
  const review = (pullRequestId: string) =>
    loadReviewLearnings({
      workspaceId: 'ws',
      repo: 'o/scope',
      pullRequestId,
      reviewedPaths: ['src/a.ts'],
    })

  beforeAll(async () => {
    for (const [id, number, state] of [
      ['pr-src', 20, 'open'],
      ['pr-other', 21, 'open'],
      ['pr-closed', 22, 'closed'],
    ] as const)
      await harness.insert('pull_requests', {
        id,
        workspaceId: 'ws',
        repo: 'o/scope',
        number,
        state,
      })
    for (const [memoryId, src, reply, rule] of [
      ['m-scope', 'pr-src', 'scope-1', RULE],
      ['m-closed', 'pr-closed', 'scope-2', 'Closed PR learning stays with it.'],
    ] as const) {
      await harness.insert('memories', {
        id: memoryId,
        workspaceId: 'ws',
        projectId: 'p1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: content(rule),
        status: 'ACTIVE',
      })
      await repo.create(
        learning({
          memoryId,
          repo: 'o/scope',
          sourcePullRequestId: src,
          sourceReplyId: reply,
        })
      )
    }
  })

  it('open source PR: applies to that PR only', async () => {
    expect(await review('pr-src')).toContain(RULE)
    expect(await review('pr-other')).not.toContain(RULE)
  })

  it('closed without merging: stays with that PR', async () => {
    expect(await review('pr-closed')).toContain('Closed PR learning')
    expect(await review('pr-other')).not.toContain('Closed PR learning')
  })

  it('merged source PR: repository-wide even with no promotion recorded (missed merge event)', async () => {
    await harness.prisma!.pullRequest.update({
      where: { id: 'pr-src' },
      data: { state: 'merged' },
    })
    expect(await review('pr-other')).toContain(RULE)
    await harness.prisma!.pullRequest.update({
      where: { id: 'pr-src' },
      data: { state: 'open' },
    })
  })

  it('the merge hook promotes once (idempotent) and the promotion alone makes it repository-wide', async () => {
    const at = new Date('2026-10-14T00:00:00Z')
    await expect(promoteLearningsOnMerge('ws', 'pr-src', at)).resolves.toBe(1)
    await expect(
      promoteLearningsOnMerge('ws', 'pr-src', new Date())
    ).resolves.toBe(0)
    // Another workspace cannot promote this workspace's learning.
    await expect(promoteLearningsOnMerge('ws2', 'pr-src')).resolves.toBe(0)
    const rows = await harness.prisma!.prReviewLearning.findMany({
      where: { sourceReplyId: 'scope-1' },
      select: { repoWideAt: true },
    })
    expect(rows[0]!.repoWideAt).toEqual(at)
    // Source PR still reads 'open' here: the stored promotion decides.
    expect(await review('pr-other')).toContain(RULE)
  })
})
