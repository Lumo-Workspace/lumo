/**
 * @jest-environment node
 *
 * LUM-929 — PR↔task linking on a repository several workspaces confirmed,
 * against a REAL Postgres (every migration replayed into PGlite) through the
 * production soft-delete extension. The real webhook handler, github service,
 * manual-link service and repositories run; only outbound side effects (scan
 * dispatch, lineage, notifications) are stubbed so their calls can be read.
 *
 * Rulings (user, 2026-10-01): an identifier held by more than one workspace
 * that confirmed the repository is never linked automatically; a link that
 * already exists keeps working after the repository becomes shared; a manual
 * link claims the PR and is reported as shared.
 *
 * LUM-1064: plugin half of __tests__/integrations/github/shared-repo-linking.real-postgres.test.ts (split)
 */
import { createPgliteHarness } from '../../../../../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)
const holder: { client: import('@prisma/client').PrismaClient | null } = {
  client: null,
}

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.client
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: (p: unknown) => p }))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
  shouldScanOnPrEvent: jest.fn().mockReturnValue(true),
}))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: jest.fn(),
}))
jest.mock('@/lib/services/claim-faithfulness-trigger', () => ({
  enqueueFaithfulnessJudgeOnMerge: jest.fn(),
}))
jest.mock('@/lib/services/boundary-crossing-rejudge-trigger', () => ({
  enqueueCrossingRejudgeOnPrClose: jest.fn(),
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
}))
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: { recordRevertsFromPush: jest.fn() },
}))
jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn().mockResolvedValue(null),
  getActorClerkId: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
  sendDMNotification: jest.fn(),
}))

import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { githubService } from '@/lib/services/github.service'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { stampLineageInBackground } from '@/lib/services/lineage-outcome.service'
import { enqueueFaithfulnessJudgeOnMerge } from '@/lib/services/claim-faithfulness-trigger'
import { enqueueCrossingRejudgeOnPrClose } from '@/lib/services/boundary-crossing-rejudge-trigger'

jest.setTimeout(180_000)

const db = () => harness.prisma!

/** Workspace with an App installation, a LUM team and a project. */
async function seedWorkspace(ws: string, installationId: number) {
  await db().workspace.create({ data: { id: ws, name: ws, slug: ws } })
  await db().workspaceMember.create({
    data: {
      id: `m-${ws}`,
      workspaceId: ws,
      clerkId: `clerk-${ws}`,
      role: 'OWNER',
    },
  })
  await db().team.create({
    data: { id: `team-${ws}`, workspaceId: ws, name: 'Eng', identifier: 'LUM' },
  })
  await db().project.create({
    data: {
      id: `proj-${ws}`,
      workspaceId: ws,
      teamId: `team-${ws}`,
      createdByMemberId: `m-${ws}`,
      name: `Project ${ws}`,
    },
  })
  await db().gitHubAppInstallation.create({
    data: { workspaceId: ws, installationId, repositories: [] },
    select: { id: true },
  })
}

async function seedTask(ws: string, number: number, deleted = false) {
  return db().task.create({
    data: {
      id: `t-${ws}-${number}`,
      number,
      title: `${ws} task ${number}`,
      projectId: `proj-${ws}`,
      workspaceId: ws,
      teamId: `team-${ws}`,
      ...(deleted ? { deletedAt: new Date() } : {}),
    },
  })
}

async function confirm(ws: string, ...repos: string[]) {
  const row = await db().gitHubAppInstallation.findUniqueOrThrow({
    where: { workspaceId: ws },
    select: { repositories: true },
  })
  await db().gitHubAppInstallation.update({
    where: { workspaceId: ws },
    data: { repositories: [...row.repositories, ...repos] },
    select: { id: true },
  })
}

function prEvent(
  repo: string,
  number: number,
  ref: string,
  action: string,
  merged = false
) {
  return {
    action,
    repository: { full_name: repo },
    pull_request: {
      number,
      title: `PR ${number}`,
      html_url: `https://github.com/${repo}/pull/${number}`,
      state: merged ? 'closed' : 'open',
      merged,
      draft: false,
      user: { login: 'octo' },
      head: { ref, sha: `sha-${number}-${action}` },
      base: { ref: 'main' },
      merged_at: merged ? '2026-10-01T00:00:00Z' : null,
      closed_at: merged ? '2026-10-01T00:00:00Z' : null,
      merge_commit_sha: merged ? 'merge-sha' : null,
    },
  }
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  await seedWorkspace('ws-a', 1)
  await seedWorkspace('ws-b', 2)
  // LUM-123 exists in both workspaces; LUM-60 only in B; LUM-77 is live in A
  // and in B's trash.
  await seedTask('ws-a', 123)
  await seedTask('ws-b', 123)
  await seedTask('ws-b', 60)
  await seedTask('ws-a', 77)
  await seedTask('ws-b', 77, true)
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(() => jest.clearAllMocks())

it('an existing link keeps scanning after the repo becomes shared', async () => {
  const REPO = 'acme/existing'
  const BRANCH = 'lumo/LUM-123-feature'
  await confirm('ws-a', REPO)
  await handlePullRequest(prEvent(REPO, 5, BRANCH, 'opened'), 'ws-a', null)
  const aRow = await pullRequestRepository.findByRepoAndNumber('ws-a', REPO, 5)
  expect(aRow?.taskId).toBe('t-ws-a-123')

  await confirm('ws-b', REPO)
  // The branch lookup is now ambiguous for both workspaces.
  expect(
    await githubService.findTaskByIdentifier('LUM', 123, 'ws-a', REPO)
  ).toBeNull()
  jest.clearAllMocks()

  // A new push to A's PR is still scanned on A's row.
  await handlePullRequest(prEvent(REPO, 5, BRANCH, 'synchronize'), 'ws-a', null)
  expect(dispatchPrSecurityScan).toHaveBeenCalledWith(aRow!.id, 'PR_EVENT')
  expect(
    (await pullRequestRepository.findByRepoAndNumber('ws-a', REPO, 5))?.taskId
  ).toBe('t-ws-a-123')

  // Merging still runs the post-merge passes for A's task.
  await handlePullRequest(
    prEvent(REPO, 5, BRANCH, 'closed', true),
    'ws-a',
    null
  )
  expect(stampLineageInBackground).toHaveBeenCalled()
  expect(enqueueFaithfulnessJudgeOnMerge).toHaveBeenCalledWith(
    'merged',
    't-ws-a-123'
  )
  expect(enqueueCrossingRejudgeOnPrClose).toHaveBeenCalledWith(
    'merged',
    't-ws-a-123'
  )

  // B's copy of the event creates no link and dispatches nothing for B.
  jest.clearAllMocks()
  await handlePullRequest(
    prEvent(REPO, 5, BRANCH, 'closed', true),
    'ws-b',
    null
  )
  const bRow = await pullRequestRepository.findByRepoAndNumber('ws-b', REPO, 5)
  expect(bRow?.taskId).toBeNull()
  expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  expect(enqueueFaithfulnessJudgeOnMerge).not.toHaveBeenCalled()
})

it('manual link on a shared repo is allowed', async () => {
  const SHARED = 'acme/manual'
  await confirm('ws-a', SHARED)
  await confirm('ws-b', SHARED)
  // Both workspaces hold an unlinked row (ambiguous branch → nobody linked).
  for (const ws of ['ws-a', 'ws-b']) {
    await handlePullRequest(
      prEvent(SHARED, 9, 'lumo/LUM-123-shared', 'opened'),
      ws,
      null
    )
  }
  expect(await pullRequestRepository.countTaskLinkedWorkspaces(SHARED, 9)).toBe(
    0
  )

  const bRow = await pullRequestRepository.findByRepoAndNumber(
    'ws-b',
    SHARED,
    9
  )
  const linked = await linkPullRequest('t-ws-b-123', { prId: bRow!.id })
  expect(linked.taskId).toBe('t-ws-b-123')
  expect(dispatchPrSecurityScan).toHaveBeenCalledWith(bRow!.id, 'PR_LINK')
  // One linked workspace: the outbound mirror guard (> 1) lets B's comments through.
  expect(await pullRequestRepository.countTaskLinkedWorkspaces(SHARED, 9)).toBe(
    1
  )
})
