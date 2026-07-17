/** @jest-environment node */
jest.mock('@/lib/repositories/idea-pull-request.repository', () => ({
  ideaPullRequestRepository: {
    create: jest.fn(),
    listByIdea: jest.fn(),
    findByIdeaAndPr: jest.fn(),
    getById: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByRepo: jest.fn(),
    upsertPullRequest: jest.fn(),
  },
}))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest.fn(),
}))
jest.mock('@/lib/integrations/github/fetch-pull-request', () => ({
  ...jest.requireActual('@/lib/integrations/github/fetch-pull-request'),
  fetchPullRequest: jest.fn(),
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn(() => 'plaintext-token') }))

import { ideaPullRequestService } from '@/lib/services/idea-pull-request.service'
import { ideaPullRequestRepository } from '@/lib/repositories/idea-pull-request.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { fetchPullRequest } from '@/lib/integrations/github/fetch-pull-request'

const mockResolve = resolveIdeaRef as jest.Mock
const mockRepo = ideaPullRequestRepository as jest.Mocked<
  typeof ideaPullRequestRepository
>
const mockPrRepo = pullRequestRepository as jest.Mocked<
  typeof pullRequestRepository
>
const mockGh = githubRepository as jest.Mocked<typeof githubRepository>
const mockFetchPr = fetchPullRequest as jest.Mock

const WS = 'ws1'
const IDEA = 'idea1'

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockResolvedValue({
    ideaId: IDEA,
    workspaceId: WS,
    teamId: 'team1',
  })
  mockRepo.findByIdeaAndPr.mockResolvedValue(null)
  // Echo the input back with an id — the assertions care about what was
  // written, not the row shape.
  mockRepo.create.mockImplementation((input =>
    Promise.resolve({
      id: 'cit1',
      ...input,
    })) as typeof mockRepo.create)
})

describe('ideaPullRequestService.link', () => {
  it('cites an already-synced PR by id', async () => {
    mockPrRepo.findById.mockResolvedValue({
      id: 'pr1',
      workspaceId: WS,
    } as never)

    await ideaPullRequestService.link({
      workspaceId: WS,
      ideaRef: IDEA,
      prId: 'pr1',
      createdById: 'm1',
    })

    expect(mockRepo.create).toHaveBeenCalledWith({
      ideaId: IDEA,
      pullRequestId: 'pr1',
      workspaceId: WS,
      createdById: 'm1',
    })
  })

  it('citing a PR never claims it for a task', async () => {
    // A PR already owned by a task is the normal case for an idea citation.
    mockPrRepo.findById.mockResolvedValue({
      id: 'pr1',
      workspaceId: WS,
      taskId: 'task-owning-it',
    } as never)

    await ideaPullRequestService.link({
      workspaceId: WS,
      ideaRef: IDEA,
      prId: 'pr1',
      createdById: 'm1',
    })

    // No 409, and crucially nothing wrote PullRequest.taskId.
    expect(mockRepo.create).toHaveBeenCalled()
    expect(
      (mockPrRepo as unknown as { updateTaskId?: jest.Mock }).updateTaskId
    ).toBeUndefined()
  })

  it('rejects a PR from another workspace', async () => {
    mockPrRepo.findById.mockResolvedValue({
      id: 'pr1',
      workspaceId: 'other-ws',
    } as never)

    await expect(
      ideaPullRequestService.link({
        workspaceId: WS,
        ideaRef: IDEA,
        prId: 'pr1',
        createdById: 'm1',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('reuses an already-tracked PR when given its URL', async () => {
    mockPrRepo.findByRepoAndNumber.mockResolvedValue({
      id: 'pr9',
      workspaceId: WS,
    } as never)

    await ideaPullRequestService.link({
      workspaceId: WS,
      ideaRef: IDEA,
      url: 'https://github.com/acme/app/pull/42',
      createdById: 'm1',
    })

    expect(mockPrRepo.findByRepoAndNumber).toHaveBeenCalledWith('acme/app', 42)
    expect(mockFetchPr).not.toHaveBeenCalled()
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestId: 'pr9' })
    )
  })

  it('fetches and upserts a PR the workspace does not track yet', async () => {
    mockPrRepo.findByRepoAndNumber.mockResolvedValue(null)
    mockGh.findIntegrationByRepo.mockResolvedValue({
      id: 'int1',
      accessToken: 'enc',
    } as never)
    mockFetchPr.mockResolvedValue({
      number: 42,
      title: 'Add thing',
      html_url: 'https://github.com/acme/app/pull/42',
      state: 'closed',
      merged: true,
      draft: false,
      user: { login: 'octocat' },
      head: { ref: 'feat' },
      base: { ref: 'main' },
      merged_at: '2026-07-01T00:00:00Z',
      closed_at: '2026-07-01T00:00:00Z',
    })
    mockGh.upsertPullRequest.mockResolvedValue({ id: 'pr-new' } as never)

    await ideaPullRequestService.link({
      workspaceId: WS,
      ideaRef: IDEA,
      url: 'https://github.com/acme/app/pull/42',
      createdById: 'm1',
    })

    expect(mockGh.upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'acme/app',
        number: 42,
        state: 'merged', // merged wins over GitHub's "closed"
        taskId: null, // an idea citation never claims the PR for a task
      })
    )
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestId: 'pr-new' })
    )
  })

  it('reports a workspace with no GitHub integration for the repo as 400', async () => {
    mockPrRepo.findByRepoAndNumber.mockResolvedValue(null)
    mockGh.findIntegrationByRepo.mockResolvedValue(null)

    await expect(
      ideaPullRequestService.link({
        workspaceId: WS,
        ideaRef: IDEA,
        url: 'https://github.com/acme/app/pull/42',
        createdById: 'm1',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(mockFetchPr).not.toHaveBeenCalled()
  })

  it('rejects a malformed PR URL', async () => {
    await expect(
      ideaPullRequestService.link({
        workspaceId: WS,
        ideaRef: IDEA,
        url: 'https://example.com/not-a-pr',
        createdById: 'm1',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('is idempotent — citing the same PR twice does not duplicate', async () => {
    mockPrRepo.findById.mockResolvedValue({
      id: 'pr1',
      workspaceId: WS,
    } as never)
    mockRepo.findByIdeaAndPr.mockResolvedValue({ id: 'existing' } as never)

    const result = await ideaPullRequestService.link({
      workspaceId: WS,
      ideaRef: IDEA,
      prId: 'pr1',
      createdById: 'm1',
    })

    expect(result).toMatchObject({ id: 'existing' })
    expect(mockRepo.create).not.toHaveBeenCalled()
  })
})

describe('ideaPullRequestService.unlink', () => {
  it('drops the citation but never the pull request itself', async () => {
    mockRepo.getById.mockResolvedValue({
      id: 'cit1',
      ideaId: IDEA,
      workspaceId: WS,
    } as never)

    await ideaPullRequestService.unlink({
      workspaceId: WS,
      ideaRef: IDEA,
      citationId: 'cit1',
    })

    expect(mockRepo.delete).toHaveBeenCalledWith('cit1')
  })

  it('404s a citation belonging to another workspace', async () => {
    mockRepo.getById.mockResolvedValue({
      id: 'cit1',
      ideaId: IDEA,
      workspaceId: 'other-ws',
    } as never)

    await expect(
      ideaPullRequestService.unlink({
        workspaceId: WS,
        ideaRef: IDEA,
        citationId: 'cit1',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mockRepo.delete).not.toHaveBeenCalled()
  })

  it('404s a citation belonging to another idea', async () => {
    mockRepo.getById.mockResolvedValue({
      id: 'cit1',
      ideaId: 'other-idea',
      workspaceId: WS,
    } as never)

    await expect(
      ideaPullRequestService.unlink({
        workspaceId: WS,
        ideaRef: IDEA,
        citationId: 'cit1',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mockRepo.delete).not.toHaveBeenCalled()
  })
})

describe('ideaPullRequestService.list', () => {
  it('lists via the resolved idea, scoping to the caller team', async () => {
    mockRepo.listByIdea.mockResolvedValue([] as never)
    await ideaPullRequestService.list({ workspaceId: WS, ideaRef: 'LUM-I7' })
    expect(mockResolve).toHaveBeenCalledWith({
      workspaceId: WS,
      ideaRef: 'LUM-I7',
    })
    expect(mockRepo.listByIdea).toHaveBeenCalledWith(IDEA)
  })
})
