/**
 * @jest-environment node
 */
/**
 * LUM-883 — the three ways a member could pull an unconfirmed repository into
 * Lumo: link a PR to a task by URL, cite a PR on an idea by URL, add a
 * repository to a project. Each must refuse with 403 before any row is
 * written, any GitHub call is made or any scan is dispatched.
 *
 * The real token layer runs (auth.ts + confirmed-repositories.ts); only the
 * installation row, the persistence layer and the network are stubbed.
 */
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
    updateTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: { upsertPullRequest: jest.fn() },
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    isRepoConfirmedElsewhere: jest.fn().mockResolvedValue(false),
  },
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/idea-pull-request.repository', () => ({
  ideaPullRequestRepository: {
    findByIdeaAndPr: jest.fn(),
    create: jest.fn(),
  },
}))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest
    .fn()
    .mockResolvedValue({ ideaId: 'idea_1', workspaceId: 'ws_1', teamId: 't' }),
}))
jest.mock('@/lib/repositories', () => ({
  projectRepository: {
    findRepositories: jest.fn(),
    clearDefaultRepositories: jest.fn(),
    countRepositories: jest.fn().mockResolvedValue(0),
    createRepository: jest.fn(),
  },
}))
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue({ userId: 'clerk_1' }),
}))
jest.mock('@/lib/api/helpers', () => {
  const actual = jest.requireActual('@/lib/api/helpers')
  return {
    ...actual,
    loadProjectAndMember: jest.fn(),
  }
})

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { waitUntil } from '@vercel/functions'
import { ideaPullRequestRepository } from '@/lib/repositories/idea-pull-request.repository'
import { projectRepository } from '@/lib/repositories'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import { ideaPullRequestService } from '@/lib/services/idea-pull-request.service'
import { POST as addProjectRepository } from '@/app/api/projects/[id]/repositories/route'

const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const createAppAuthMock = createAppAuth as unknown as jest.Mock
const ORIGINAL_FETCH = global.fetch
const ORIGINAL_ENV = process.env
let fetchMock: jest.Mock

const UNCONFIRMED_URL = 'https://github.com/acme/payroll/pull/7'

function noSideEffects() {
  expect(fetchMock).not.toHaveBeenCalled()
  expect(createAppAuthMock).not.toHaveBeenCalled()
  expect(githubRepository.upsertPullRequest).not.toHaveBeenCalled()
  expect(pullRequestRepository.updateTaskId).not.toHaveBeenCalled()
  expect(ideaPullRequestRepository.create).not.toHaveBeenCalled()
  expect(projectRepository.createRepository).not.toHaveBeenCalled()
  expect(projectRepository.clearDefaultRepositories).not.toHaveBeenCalled()
  expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    GITHUB_APP_PRIVATE_KEY: 'abc',
  }
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  createAppAuthMock.mockReturnValue(
    jest.fn().mockResolvedValue({ token: 'ghs_repo' })
  )
  findByWorkspace.mockResolvedValue({
    id: 'gai_1',
    workspaceId: 'ws_1',
    installationId: 42,
    repositories: ['acme/web'],
  })
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 'task_1',
    project: { workspaceId: 'ws_1' },
  })
  ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
    null
  )
  ;(loadProjectAndMember as jest.Mock).mockResolvedValue({
    project: { id: 'proj_1', workspaceId: 'ws_1' },
    member: { id: 'm1', role: 'MEMBER' },
    workspaceSlug: 'acme',
  })
})
afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  process.env = ORIGINAL_ENV
})

describe('LUM-883 entry points refuse an unconfirmed repository', () => {
  it('task PR link by URL is refused with 403', async () => {
    await expect(
      linkPullRequest('task_1', { url: UNCONFIRMED_URL })
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    // Not even the "do we already track it" lookup runs.
    expect(pullRequestRepository.findByRepoAndNumber).not.toHaveBeenCalled()
    noSideEffects()
  })

  it('idea PR citation by URL is refused with 403', async () => {
    await expect(
      ideaPullRequestService.link({
        workspaceId: 'ws_1',
        ideaRef: 'LUM-I1',
        url: UNCONFIRMED_URL,
        createdById: 'm1',
      })
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    expect(pullRequestRepository.findByRepoAndNumber).not.toHaveBeenCalled()
    noSideEffects()
  })

  it('project repository add is refused with 403', async () => {
    const { NextRequest } = jest.requireActual('next/server')
    const res = await addProjectRepository(
      new NextRequest('http://localhost/api/projects/proj_1/repositories', {
        method: 'POST',
        body: JSON.stringify({ fullName: 'acme/payroll', isDefault: true }),
      }),
      { params: Promise.resolve({ id: 'proj_1' }) }
    )
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      code: 'repo_not_confirmed',
    })
    noSideEffects()
  })

  it('project repository add answers 400 when the App is not installed', async () => {
    findByWorkspace.mockResolvedValue(null)
    const { NextRequest } = jest.requireActual('next/server')
    const res = await addProjectRepository(
      new NextRequest('http://localhost/api/projects/proj_1/repositories', {
        method: 'POST',
        body: JSON.stringify({ fullName: 'acme/web' }),
      }),
      { params: Promise.resolve({ id: 'proj_1' }) }
    )
    expect(res.status).toBe(400)
    noSideEffects()
  })
})

describe('LUM-883 entry points still accept a confirmed repository', () => {
  const ghPr = {
    number: 7,
    title: 'Fix',
    html_url: 'https://github.com/acme/web/pull/7',
    state: 'open',
    draft: false,
    merged_at: null,
    closed_at: null,
    user: { login: 'dev' },
    head: { ref: 'fix', sha: 'abc' },
    base: { ref: 'main' },
  }

  it('task PR link by URL of a confirmed repository (any case) fetches, links and scans', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ghPr,
    })
    ;(githubRepository.upsertPullRequest as jest.Mock).mockResolvedValue({
      id: 'pr_1',
      taskId: null,
    })
    ;(pullRequestRepository.updateTaskId as jest.Mock).mockResolvedValue({
      id: 'pr_1',
      repo: 'Acme/Web',
    })

    await linkPullRequest('task_1', {
      url: 'https://github.com/Acme/Web/pull/7',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // LUM-889: looked up and stored under the confirmed (GitHub) spelling, so
    // `Acme/Web` never forks a duplicate of the webhook's `acme/web` row.
    expect(pullRequestRepository.findByRepoAndNumber).toHaveBeenCalledWith(
      'ws_1',
      'acme/web',
      7
    )
    expect(githubRepository.upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'acme/web' })
    )
    expect(pullRequestRepository.updateTaskId).toHaveBeenCalledWith(
      'pr_1',
      'task_1'
    )
    expect(dispatchPrSecurityScan).toHaveBeenCalledWith('pr_1', 'PR_LINK')
  })

  it('project repository add of a confirmed repository is written', async () => {
    ;(projectRepository.createRepository as jest.Mock).mockResolvedValue({
      id: 'repo_1',
    })
    const { NextRequest } = jest.requireActual('next/server')
    const res = await addProjectRepository(
      new NextRequest('http://localhost/api/projects/proj_1/repositories', {
        method: 'POST',
        body: JSON.stringify({ fullName: 'acme/web' }),
      }),
      { params: Promise.resolve({ id: 'proj_1' }) }
    )
    expect(res.status).toBe(201)
    expect(projectRepository.createRepository).toHaveBeenCalledWith({
      projectId: 'proj_1',
      fullName: 'acme/web',
      name: 'web',
      isDefault: true,
    })
  })
})
