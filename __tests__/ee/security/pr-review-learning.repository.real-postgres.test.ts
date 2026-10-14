/** @jest-environment node */
/**
 * LUM-1131 — `PrReviewLearning` against a real Postgres replayed from every
 * migration (the LUM-1131 migration itself is exercised): a learning counts
 * only while its memory is ACTIVE, deleting the memory deletes the learning,
 * reads never cross workspaces, a reply makes at most one learning, and a
 * thread answers each reply once.
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
  prReviewLearningRepository as repo,
  type NewReviewLearning,
} from '@/ee/security/repositories/pr-review-learning.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { loadReviewLearnings } from '@/ee/security/services/review-learnings.service'

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
