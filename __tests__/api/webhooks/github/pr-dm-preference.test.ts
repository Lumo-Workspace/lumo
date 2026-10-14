/** @jest-environment node */
/**
 * LUM-1101 — the pull_request webhook's personal Slack DMs (pr_opened to the
 * project owner, pr_merged to the assignee) went straight to
 * sendDMNotification, so the "Task assigned" Slack switch could not silence
 * them. The real preference gate runs here against a mocked prisma.
 */
import { handlePullRequest } from '@/app/api/webhooks/github/handlers'
import { githubService } from '@/lib/services/github.service'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack'
import { getActorClerkId, getHumanActorId } from '@/lib/actor'
import { prisma } from '@/lib/db/prisma'

const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
  },
}))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: jest.fn(),
  getHumanActorId: jest.fn(),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn().mockResolvedValue(undefined),
  sendDMNotification: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn() },
    userPreference: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    upsertPullRequest: jest.fn().mockResolvedValue({ id: 'pr-row-1' }),
    upsertTaskBranch: jest.fn(),
    findTaskByIdentifier: jest.fn(),
    resolvePullRequestTask: jest.fn(async (task: unknown) => task),
    findWorkspaceSlug: jest.fn().mockResolvedValue('lumo'),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findByRepoAndNumber: jest.fn(),
    findByHeadBranch: jest.fn(),
  },
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { runInbound: jest.fn() },
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
jest.mock('@/lib/services/outcome/git-outcome-recorder', () => ({
  gitOutcomeRecorder: { onPush: jest.fn() },
}))
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

const findTaskByIdentifier = githubService.findTaskByIdentifier as jest.Mock
const mockDM = sendDMNotification as jest.Mock
const mockChannel = sendChannelNotification as jest.Mock
const mockActorFindUnique = prisma.actor.findUnique as jest.Mock
const mockPrefFindUnique = prisma.userPreference.findUnique as jest.Mock

async function flush() {
  while (waitUntilPromises.length > 0) {
    await Promise.all(waitUntilPromises.splice(0))
  }
}

const task = {
  id: 'task-1',
  number: 821,
  title: 'x',
  status: 'IN_PROGRESS',
  projectId: 'p1',
  assigneeActorId: 'a-assignee',
  project: { name: 'Lumo', ownerId: 'm-owner', workspaceId: 'ws-1' },
  team: { identifier: 'LUM' },
}

const basePr = {
  number: 1071,
  title: 'feat: x',
  html_url: 'https://github.com/a/b/pull/1071',
  draft: false,
  user: { login: 'octocat' },
  head: { ref: 'lumo/LUM-821-x', sha: 'abc' },
  base: { ref: 'main' },
}
const openedPayload = {
  action: 'opened',
  pull_request: {
    ...basePr,
    state: 'open',
    merged: false,
    merged_at: null,
    closed_at: null,
  },
  repository: { full_name: 'a/b' },
}
const mergedPayload = {
  action: 'closed',
  pull_request: {
    ...basePr,
    state: 'closed',
    merged: true,
    merged_by: { login: 'hubot' },
    merged_at: '2026-10-13T00:00:00Z',
    closed_at: '2026-10-13T00:00:00Z',
    merge_commit_sha: 'def',
  },
  repository: { full_name: 'a/b' },
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
  findTaskByIdentifier.mockResolvedValue(task)
  ;(getHumanActorId as jest.Mock).mockResolvedValue('a-owner')
  ;(getActorClerkId as jest.Mock).mockImplementation((id: string) =>
    Promise.resolve(id === 'a-owner' ? 'user_owner' : 'user_assignee')
  )
  mockActorFindUnique.mockResolvedValue({ member: { id: 'm-1' } })
})

describe('PR webhook Slack DMs honour the Slack "Task assigned" switch (LUM-1101)', () => {
  it('pr_opened: no DM to the owner who turned the switch off', async () => {
    mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: false })
    await handlePullRequest(openedPayload, 'ws-1', null)
    await flush()
    expect(mockDM).not.toHaveBeenCalled()
    expect(mockChannel).toHaveBeenCalledWith(
      'ws-1',
      'pr_opened',
      expect.anything(),
      'p1'
    )
  })

  it('pr_opened: DMs the owner when the switch is on', async () => {
    mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: true })
    await handlePullRequest(openedPayload, 'ws-1', null)
    await flush()
    expect(mockDM).toHaveBeenCalledWith(
      'ws-1',
      'user_owner',
      'pr_opened',
      expect.anything()
    )
    expect(mockActorFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a-owner' } })
    )
  })

  it('pr_merged: no DM to the assignee who turned the switch off', async () => {
    mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: false })
    await handlePullRequest(mergedPayload, 'ws-1', null)
    await flush()
    expect(mockDM).not.toHaveBeenCalled()
    expect(mockChannel).toHaveBeenCalledWith(
      'ws-1',
      'pr_merged',
      expect.anything(),
      'p1'
    )
  })

  it('pr_merged: DMs the assignee when no preference row exists', async () => {
    mockPrefFindUnique.mockResolvedValue(null)
    await handlePullRequest(mergedPayload, 'ws-1', null)
    await flush()
    expect(mockDM).toHaveBeenCalledWith(
      'ws-1',
      'user_assignee',
      'pr_merged',
      expect.anything()
    )
    expect(mockActorFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a-assignee' } })
    )
  })
})
